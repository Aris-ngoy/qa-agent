/**
 * The Android instrumentation helper (`yoqa.android.devtools`, source in
 * `native/android-devtools`): a test-only APK that `am instrument` keeps running on the
 * device, serving the foreground window's tree over one `adb forward`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AdbExec } from "./android-direct-lane";

/** One node of the foreground window as the helper reports it. Bounds are 0.0–1.0 of the display. */
export type DevtoolsNode = {
	role: string;
	/** Content description. */
	label?: string;
	/** Text. */
	value?: string;
	/** Resource id. */
	id?: string;
	bounds: { x: number; y: number; width: number; height: number };
	enabled: boolean;
};

/**
 * The foreground window. `display` is the display's current size in pixels (it follows
 * rotation, as a dump's bounds do); an empty `nodes` means the window couldn't be read.
 */
export type DevtoolsTree = {
	nodes: DevtoolsNode[];
	display?: { width: number; height: number };
};

/** A running helper for one serial. `stop` ends it and removes its port forward. */
export type AndroidDevtools = {
	tree: () => Promise<DevtoolsTree>;
	stop: () => Promise<void>;
};

function escapeAttr(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

/**
 * The helper's tree as a `uiautomator dump`, with bounds converted to pixels of the
 * display it reports (else `window`), so the Lane's Screen, alerts and locators read it
 * exactly as they read a dump.
 */
export function devtoolsTreeToDump(
	tree: DevtoolsTree,
	window: { width: number; height: number },
): string {
	const size = tree.display ?? window;
	const px = (fraction: number, size: number) => Math.round(fraction * size);
	const body = tree.nodes
		.map((node) => {
			const x1 = px(node.bounds.x, size.width);
			const y1 = px(node.bounds.y, size.height);
			const x2 = px(node.bounds.x + node.bounds.width, size.width);
			const y2 = px(node.bounds.y + node.bounds.height, size.height);
			const attrs = [
				`class="${escapeAttr(node.role)}"`,
				`text="${escapeAttr(node.value ?? "")}"`,
				`resource-id="${escapeAttr(node.id ?? "")}"`,
				`content-desc="${escapeAttr(node.label ?? "")}"`,
				`enabled="${node.enabled}"`,
				`bounds="[${x1},${y1}][${x2},${y2}]"`,
			];
			return `<node ${attrs.join(" ")} />`;
		})
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?><hierarchy rotation="0">${body}</hierarchy>`;
}

/** The helper's package and instrumentation (see `native/android-devtools`). */
export const DEVTOOLS_PACKAGE = "yoqa.android.devtools";
const DEVTOOLS_INSTRUMENTATION = `${DEVTOOLS_PACKAGE}/.DevtoolsInstrumentation`;
/** Bump with `versionCode` in `native/android-devtools/app/build.gradle.kts`. */
export const DEVTOOLS_VERSION_CODE = 1;
/** The port the helper listens on, on the device's loopback. */
export const DEVTOOLS_DEVICE_PORT = 7421;

const READY_TIMEOUT_MS = 10_000;
const TREE_TIMEOUT_MS = 5_000;

/** A long-lived adb process (here, `am instrument -w`). */
export type AdbProcess = { exited: Promise<number>; kill: () => void };
export type SpawnAdb = (args: string[]) => AdbProcess;

/** Starts the helper for one serial, or rejects when it isn't installed or doesn't answer. */
export type StartAndroidDevtools = (context: {
	serial: string;
	adb: AdbExec;
	spawnAdb: SpawnAdb;
}) => Promise<AndroidDevtools>;

export type AndroidDevtoolsDeps = {
	/** The helper APK to install when the device lacks it or has another version. */
	apkPath?: string | null;
	readyTimeoutMs?: number;
};

/** The helper APK built from `native/android-devtools`, or `YOQA_ANDROID_DEVTOOLS_APK`. */
export function resolveDevtoolsApk(): string | null {
	const fromEnv = process.env.YOQA_ANDROID_DEVTOOLS_APK?.trim();
	if (fromEnv) return fromEnv;
	const built = join(
		import.meta.dir,
		"../../../../../native/android-devtools/app/build/outputs/apk/debug/app-debug.apk",
	);
	return existsSync(built) ? built : null;
}

async function adbOk(adb: AdbExec, args: string[], label: string): Promise<string> {
	const result = await adb(args);
	if (result.exitCode !== 0) {
		throw new Error(
			`${label}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
		);
	}
	return result.stdout;
}

async function installedVersion(adb: AdbExec, serial: string): Promise<number | null> {
	const stdout = await adbOk(
		adb,
		["-s", serial, "shell", "pm", "list", "packages", "--show-versioncode", DEVTOOLS_PACKAGE],
		"pm list packages",
	);
	const line = stdout.split("\n").find((l) => l.trim().startsWith(`package:${DEVTOOLS_PACKAGE} `));
	const version = line?.match(/versionCode:(\d+)/)?.[1];
	return version ? Number(version) : null;
}

/** Forwards this serial's earlier runs left behind (a crash skips `stop`). */
async function removeStaleForwards(adb: AdbExec, serial: string): Promise<void> {
	const stdout = await adbOk(adb, ["forward", "--list"], "adb forward --list");
	for (const line of stdout.split("\n")) {
		const [lineSerial, local, remote] = line.trim().split(/\s+/);
		if (lineSerial === serial && local && remote === `tcp:${DEVTOOLS_DEVICE_PORT}`) {
			await adb(["-s", serial, "forward", "--remove", local]);
		}
	}
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
	const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
	if (!response.ok) throw new Error(`${url} answered ${response.status}`);
	return response.json();
}

async function waitUntilReady(
	base: string,
	instrument: AdbProcess,
	timeoutMs: number,
): Promise<void> {
	let exited = false;
	void instrument.exited.then(() => {
		exited = true;
	});
	const deadline = performance.now() + timeoutMs;
	let lastError: unknown = null;
	while (performance.now() < deadline) {
		if (exited) throw new Error("the helper's instrumentation exited before it answered");
		try {
			await fetchJson(`${base}/status`, 1_000);
			return;
		} catch (error) {
			lastError = error;
			await Bun.sleep(100);
		}
	}
	const detail = lastError instanceof Error ? ` (${lastError.message})` : "";
	throw new Error(`the helper did not answer within ${timeoutMs} ms${detail}`);
}

function parseTree(value: unknown): DevtoolsTree {
	const body = (typeof value === "object" && value !== null ? value : {}) as {
		nodes?: unknown;
		display?: { width?: unknown; height?: unknown };
	};
	if (!Array.isArray(body.nodes)) throw new Error("the helper returned no tree");
	const width = Number(body.display?.width);
	const height = Number(body.display?.height);
	const display = width > 0 && height > 0 ? { width, height } : undefined;
	return { nodes: body.nodes as DevtoolsNode[], ...(display ? { display } : {}) };
}

/**
 * Install the helper if needed, forward a host port to it, start its instrumentation and
 * wait until it answers. `stop` force-stops it and removes the forward.
 */
export async function startAndroidDevtools(
	context: Parameters<StartAndroidDevtools>[0],
	deps: AndroidDevtoolsDeps = {},
): Promise<AndroidDevtools> {
	const { serial, adb } = context;
	const apkPath = deps.apkPath === undefined ? resolveDevtoolsApk() : deps.apkPath;
	const version = await installedVersion(adb, serial);
	if (version !== DEVTOOLS_VERSION_CODE) {
		if (apkPath) {
			await adbOk(adb, ["-s", serial, "install", "-r", "-t", apkPath], "adb install helper");
		} else if (version === null) {
			throw new Error(`${DEVTOOLS_PACKAGE} is not installed and its APK is not built`);
		} else {
			throw new Error(
				`${DEVTOOLS_PACKAGE} version ${version} is installed, ${DEVTOOLS_VERSION_CODE} is needed, and its APK is not built`,
			);
		}
	}

	await removeStaleForwards(adb, serial);
	const hostPort = (
		await adbOk(
			adb,
			["-s", serial, "forward", "tcp:0", `tcp:${DEVTOOLS_DEVICE_PORT}`],
			"adb forward",
		)
	).trim();
	if (!/^\d+$/.test(hostPort)) throw new Error(`adb forward gave no port (${hostPort})`);
	const local = `tcp:${hostPort}`;
	const base = `http://127.0.0.1:${hostPort}`;

	// Replace a helper an earlier runner left running; only one may hold UiAutomation.
	await adb(["-s", serial, "shell", "am", "force-stop", DEVTOOLS_PACKAGE]);
	const instrument = context.spawnAdb([
		"-s",
		serial,
		"shell",
		"am",
		"instrument",
		"-w",
		"-e",
		"port",
		String(DEVTOOLS_DEVICE_PORT),
		DEVTOOLS_INSTRUMENTATION,
	]);

	let stopped = false;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		// Force-stop ends the instrumentation and releases the device's UiAutomation.
		await adb(["-s", serial, "shell", "am", "force-stop", DEVTOOLS_PACKAGE]).catch(() => undefined);
		instrument.kill();
		await adb(["-s", serial, "forward", "--remove", local]).catch(() => undefined);
	};

	try {
		await waitUntilReady(base, instrument, deps.readyTimeoutMs ?? READY_TIMEOUT_MS);
	} catch (error) {
		await stop();
		throw error;
	}

	return {
		tree: async () => parseTree(await fetchJson(`${base}/tree`, TREE_TIMEOUT_MS)),
		stop,
	};
}
