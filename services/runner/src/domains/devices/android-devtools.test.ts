import { afterEach, describe, expect, test } from "bun:test";
import {
	DEVTOOLS_DEVICE_PORT,
	DEVTOOLS_PACKAGE,
	DEVTOOLS_VERSION_CODE,
	type DevtoolsNode,
	startAndroidDevtools,
} from "./android-devtools";
import type { AdbExec, AdbResult } from "./android-direct-lane";

const SERIAL = "emulator-5554";

const NODES: DevtoolsNode[] = [
	{
		role: "android.widget.Button",
		value: "Allow",
		bounds: { x: 0.1, y: 0.5, width: 0.4, height: 0.06 },
		enabled: true,
	},
];

function ok(stdout = ""): AdbResult {
	return { stdout, stderr: "", exitCode: 0 };
}

/**
 * A device with adb faked: it keeps the host's forward table, and the helper is a local
 * HTTP server that answers only while its instrumentation runs.
 */
function fakeDevice(options: { installedVersion?: number | null; apkPath?: string | null } = {}) {
	const forwards: Array<{ serial: string; local: string; remote: string }> = [];
	const installs: string[][] = [];
	let instrumentations = 0;
	let running = false;
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		fetch: (request) => {
			if (!running) return new Response("starting", { status: 503 });
			const path = new URL(request.url).pathname;
			if (path === "/status") return Response.json({ ok: true });
			if (path === "/tree") return Response.json({ nodes: NODES });
			return new Response("not found", { status: 404 });
		},
	});
	let installedVersion =
		options.installedVersion === undefined ? DEVTOOLS_VERSION_CODE : options.installedVersion;

	const adb: AdbExec = async (args) => {
		const joined = args.join(" ");
		if (joined.includes("pm list packages")) {
			return ok(
				installedVersion === null
					? ""
					: `package:${DEVTOOLS_PACKAGE} versionCode:${installedVersion}\n`,
			);
		}
		if (args.includes("install")) {
			installs.push(args);
			installedVersion = DEVTOOLS_VERSION_CODE;
			return ok("Success\n");
		}
		if (args.includes("forward") && args.includes("--list")) {
			return ok(forwards.map((f) => `${f.serial} ${f.local} ${f.remote}\n`).join(""));
		}
		if (args.includes("forward") && args.includes("--remove")) {
			const local = args.at(-1);
			const index = forwards.findIndex((f) => f.serial === args[1] && f.local === local);
			if (index < 0) return { stdout: "", stderr: "error: listener not found", exitCode: 1 };
			forwards.splice(index, 1);
			return ok();
		}
		if (args.includes("forward")) {
			forwards.push({
				serial: args[1] ?? "",
				local: `tcp:${server.port}`,
				remote: args.at(-1) ?? "",
			});
			return ok(`${server.port}\n`);
		}
		if (joined.includes("am force-stop")) {
			running = false;
			return ok();
		}
		return ok();
	};

	const spawnAdb = (args: string[]) => {
		if (args.includes("instrument")) {
			instrumentations += 1;
			running = true;
		}
		let resolveExit: (code: number) => void = () => undefined;
		const exited = new Promise<number>((resolve) => {
			resolveExit = resolve;
		});
		return {
			exited,
			kill: () => {
				running = false;
				resolveExit(0);
			},
		};
	};

	return {
		context: { serial: SERIAL, adb, spawnAdb },
		deps: { apkPath: options.apkPath === undefined ? "/tmp/yoqa-devtools.apk" : options.apkPath },
		forwards,
		installs,
		instrumentations: () => instrumentations,
		close: () => server.stop(true),
	};
}

let device: ReturnType<typeof fakeDevice> | null = null;
afterEach(() => {
	device?.close();
	device = null;
});

describe("startAndroidDevtools", () => {
	test("serves the foreground window's tree over one forward to the helper's port", async () => {
		device = fakeDevice();
		const helper = await startAndroidDevtools(device.context, device.deps);

		expect((await helper.tree()).nodes).toEqual(NODES);
		expect(device.forwards).toEqual([
			{
				serial: SERIAL,
				local: expect.stringMatching(/^tcp:\d+$/),
				remote: `tcp:${DEVTOOLS_DEVICE_PORT}`,
			},
		]);
		await helper.stop();
	});

	test("stop removes the forward, and repeated connects leave none behind", async () => {
		device = fakeDevice();
		for (let i = 0; i < 3; i++) {
			const helper = await startAndroidDevtools(device.context, device.deps);
			expect(device.forwards).toHaveLength(1);
			await helper.stop();
			await helper.stop();
			expect(device.forwards).toEqual([]);
		}
		expect(device.instrumentations()).toBe(3);
	});

	test("a forward left by a crashed run is removed before the new one is made", async () => {
		device = fakeDevice();
		device.forwards.push(
			{ serial: SERIAL, local: "tcp:50001", remote: `tcp:${DEVTOOLS_DEVICE_PORT}` },
			{ serial: "emulator-5556", local: "tcp:50002", remote: `tcp:${DEVTOOLS_DEVICE_PORT}` },
			{ serial: SERIAL, local: "tcp:50003", remote: "tcp:8080" },
		);
		const helper = await startAndroidDevtools(device.context, device.deps);
		await helper.stop();
		expect(device.forwards.map((f) => f.local)).toEqual(["tcp:50002", "tcp:50003"]);
	});

	test("installs the helper test-only when the device lacks it or has another version", async () => {
		for (const installed of [null, DEVTOOLS_VERSION_CODE - 1]) {
			const current = fakeDevice({ installedVersion: installed });
			try {
				const helper = await startAndroidDevtools(current.context, current.deps);
				await helper.stop();
				expect(current.installs).toEqual([
					["-s", SERIAL, "install", "-r", "-t", "/tmp/yoqa-devtools.apk"],
				]);
			} finally {
				current.close();
			}
		}
	});

	test("an installed helper of this version is not reinstalled", async () => {
		device = fakeDevice();
		const helper = await startAndroidDevtools(device.context, device.deps);
		await helper.stop();
		expect(device.installs).toEqual([]);
	});

	test("rejects when the helper is missing and no APK is built, without forwarding", async () => {
		device = fakeDevice({ installedVersion: null, apkPath: null });
		await expect(startAndroidDevtools(device.context, device.deps)).rejects.toThrow(
			/not installed/,
		);
		expect(device.forwards).toEqual([]);
		expect(device.instrumentations()).toBe(0);
	});

	test("a helper that never answers is stopped and leaves no forward", async () => {
		device = fakeDevice();
		const neverRuns = {
			...device.context,
			spawnAdb: () => ({ exited: new Promise<number>(() => undefined), kill: () => undefined }),
		};
		await expect(
			startAndroidDevtools(neverRuns, { ...device.deps, readyTimeoutMs: 300 }),
		).rejects.toThrow(/did not answer/);
		expect(device.forwards).toEqual([]);
	});

	test("rejects a helper of another version when no APK is built to replace it", async () => {
		device = fakeDevice({ installedVersion: DEVTOOLS_VERSION_CODE + 1, apkPath: null });
		await expect(startAndroidDevtools(device.context, device.deps)).rejects.toThrow(/version/);
		expect(device.instrumentations()).toBe(0);
	});
});
