import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { type RuntimeHost, type SpawnedProcess, bunHost } from "./host";
import { createAppiumRuntime } from "./runtime";

const NODE = "/usr/local/bin/node";
const NPM = "/usr/local/bin/npm";
const APPIUM = "/usr/local/bin/appium";
const XCODE = "/Applications/Xcode.app/Contents/Developer";

function commandResult(stdout = "", exitCode = 0, stderr = "") {
	return { stdout, stderr, exitCode };
}

function emptyHost(): RuntimeHost {
	const missed: SpawnedProcess = {
		pid: 0,
		exitCode: 1,
		exited: Promise.resolve(1),
		kill() {},
	};
	return {
		async run() {
			return commandResult("", 127, "not found");
		},
		async exists() {
			return false;
		},
		async readText() {
			return null;
		},
		async writeText() {},
		async mkdir() {},
		async listNodeBins() {
			return [];
		},
		async portFree() {
			return true;
		},
		async httpOk() {
			return false;
		},
		async listeners() {
			return [];
		},
		spawn() {
			return missed;
		},
	};
}

type SystemWorld = {
	drivers: Record<string, string>;
	files: Map<string, string>;
	paths: Set<string>;
	spawned: boolean;
	busyPorts: Set<number>;
	systemAppium: boolean;
	managedInstalled: boolean;
};

function systemHost(world: SystemWorld): RuntimeHost {
	return {
		async run(command) {
			const [bin, ...rest] = command;
			if (bin === "which") {
				const name = rest[0];
				if (name === "node") return commandResult(`${NODE}\n`);
				if (name === "npm") return commandResult(`${NPM}\n`);
				if (name === "appium" && world.systemAppium) return commandResult(`${APPIUM}\n`);
				return commandResult("", 1);
			}
			if (bin === NPM && rest[0] === "install") {
				world.managedInstalled = true;
				return commandResult("added appium");
			}
			const managedBin = join(homedir(), ".yoqa", "runtime", "node_modules", "appium", "index.js");
			if (command.includes("-v") && !command.includes("driver")) {
				if (command.includes(managedBin)) {
					return world.managedInstalled
						? commandResult("3.5.2\n")
						: commandResult("", 127, "not found");
				}
				if (command.includes(APPIUM)) return commandResult("3.5.2\n");
				if (command.includes(NODE) || bin === "node") return commandResult("v22.20.0\n");
			}
			if (command.includes("driver") && command.includes("list")) {
				const body: Record<string, { pkg: { version: string }; installed: boolean }> = {};
				for (const [name, version] of Object.entries(world.drivers)) {
					body[name] = { pkg: { version }, installed: true };
				}
				return commandResult(JSON.stringify(body));
			}
			if (command.includes("driver") && command.includes("install")) {
				const spec = command.find((part) => part.includes("@")) ?? "";
				const [name, version] = spec.split("@");
				if (name && version) world.drivers[name] = version;
				return commandResult("installed");
			}
			if (command.includes("devicectl") && command.includes("apps")) {
				const bundleId = command[command.indexOf("--bundle-id") + 1] ?? "";
				const jsonPath = command[command.indexOf("--json-output") + 1] ?? "";
				world.files.set(
					jsonPath,
					JSON.stringify({ result: { apps: [{ bundleIdentifier: bundleId }] } }),
				);
				return commandResult("");
			}
			if (command.includes("devicectl") && command.includes("install")) {
				return commandResult("");
			}
			return commandResult("", 127, "not found");
		},
		async exists(path) {
			return world.paths.has(path) || world.files.has(path);
		},
		async readText(path) {
			return world.files.get(path) ?? null;
		},
		async writeText(path, contents) {
			world.files.set(path, contents);
		},
		async mkdir() {},
		async listNodeBins() {
			return [];
		},
		async portFree(port) {
			return !world.busyPorts.has(port) && !world.spawned;
		},
		async httpOk() {
			return world.spawned;
		},
		async listeners() {
			return [];
		},
		spawn() {
			world.spawned = true;
			let exitCode: number | null = null;
			return {
				pid: 4242,
				get exitCode() {
					return exitCode;
				},
				exited: new Promise<number>(() => {}),
				kill() {
					exitCode = 0;
					world.spawned = false;
				},
			};
		},
	};
}

function world(partial?: Partial<SystemWorld>): SystemWorld {
	return {
		drivers: {},
		files: new Map(),
		paths: new Set([NODE, NPM, XCODE]),
		spawned: false,
		busyPorts: new Set(),
		systemAppium: true,
		managedInstalled: false,
		...partial,
	};
}

const pinned = {
	xcuitest: "11.17.7",
	uiautomator2: "8.1.0",
};

describe("Appium Runtime", () => {
	test("the real host treats a directory as present", async () => {
		const dir = await mkdtemp(join(tmpdir(), "yoqa-host-"));
		try {
			expect(await bunHost.exists(dir)).toBe(true);
			expect(await bunHost.exists(join(dir, "missing"))).toBe(false);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	test("status is not ready when Node and Appium are missing", async () => {
		const runtime = createAppiumRuntime(emptyHost());
		const status = await runtime.getStatus();

		expect(status.ready).toBe(false);
		expect(status.checks.find((check) => check.id === "node")?.ok).toBe(false);
		expect(status.checks.find((check) => check.id === "appium")).toMatchObject({
			ok: false,
			detail: "Not installed (will install 3.5.2)",
		});
	});

	test("status is ready when system Appium 3 has both pinned drivers", async () => {
		const runtime = createAppiumRuntime(systemHost(world({ drivers: { ...pinned } })));
		const status = await runtime.getStatus();

		expect(status.ready).toBe(true);
		expect(status.appiumVersion).toBe("3.5.2");
		expect(status.appiumSource).toBe("system");
		expect(status.checks.find((check) => check.id === "xcuitest")?.detail).toBe("11.17.7");
		expect(status.checks.find((check) => check.id === "uiautomator2")?.detail).toBe("8.1.0");
	});

	test("platform setup installs a missing pinned driver", async () => {
		const disk = world({ drivers: { uiautomator2: "8.1.0" } });
		const runtime = createAppiumRuntime(systemHost(disk));

		const result = await runtime.setupPlatform("ios");

		expect(result.alreadyInstalled).toBe(false);
		expect(result.driverVersion).toBe("11.17.7");
		const status = await runtime.getStatus();
		expect(status.checks.find((check) => check.id === "xcuitest")?.ok).toBe(true);
	});

	test("platform setup leaves a pinned driver in place", async () => {
		const runtime = createAppiumRuntime(systemHost(world({ drivers: { ...pinned } })));

		const result = await runtime.setupPlatform("ios");

		expect(result.alreadyInstalled).toBe(true);
		expect(result.message).toContain("xcuitest 11.17.7 is already installed");
	});

	test("physical iOS setup requires a device id", async () => {
		const runtime = createAppiumRuntime(systemHost(world({ drivers: { ...pinned } })));

		await expect(
			runtime.setupPlatform({
				platform: "ios",
				kind: "physical",
				xcodeDeveloperDir: XCODE,
				developmentTeam: "ABCDE12345",
				codeSignIdentity: "Apple Development: Yoqa",
			}),
		).rejects.toThrow("deviceId is required to install WebDriverAgent on a physical iOS device");
	});

	test("physical iOS setup reuses a prepared WebDriverAgent", async () => {
		const deviceId = "00008110-001A2B3C";
		const bundleId = "io.yoqa.WebDriverAgentRunner.ABCDE12345";
		const appPath = "/tmp/yoqa-wda/WebDriverAgentRunner-Runner.app";
		const disk = world({ drivers: { ...pinned }, paths: new Set([NODE, NPM, XCODE, appPath]) });
		disk.files.set(
			join(homedir(), ".yoqa", "devices", `${deviceId}.json`),
			JSON.stringify({
				deviceId,
				platform: "ios",
				bundleId,
				appPath,
				derivedDataPath: "/tmp/yoqa-wda/DerivedData",
				developmentTeam: "ABCDE12345",
				codeSignIdentity: "Apple Development: Yoqa",
				xcodeDeveloperDir: XCODE,
				installedAt: "2026-09-01T00:00:00.000Z",
			}),
		);
		const runtime = createAppiumRuntime(systemHost(disk));

		const result = await runtime.setupPlatform({
			platform: "ios",
			kind: "physical",
			deviceId,
			xcodeDeveloperDir: XCODE,
			developmentTeam: "ABCDE12345",
			codeSignIdentity: "Apple Development: Yoqa",
		});

		expect(result.wdaAction).toBe("reused");
		expect(result.wdaBundleId).toBe(bundleId);
		const prep = await runtime.readDevicePrep(deviceId);
		expect(prep?.bundleId).toBe(bundleId);
		expect(prep?.installedAt).toBe("2026-09-01T00:00:00.000Z");
	});

	test("ensure installs managed Appium when none is on PATH, then both drivers", async () => {
		const runtime = createAppiumRuntime(systemHost(world({ systemAppium: false })));

		const result = await runtime.ensure();

		expect(result.ready).toBe(true);
		expect(result.status.appiumSource).toBe("managed");
		expect(result.status.appiumVersion).toBe("3.5.2");
		expect(result.message).toBe("Installed missing Appium drivers");
	});

	test("ensure installs both platform drivers and reports ready", async () => {
		const runtime = createAppiumRuntime(systemHost(world()));

		const result = await runtime.ensure();

		expect(result.ready).toBe(true);
		expect(result.message).toBe("Installed missing Appium drivers");
		const status = await runtime.getStatus();
		expect(status.checks.find((check) => check.id === "xcuitest")?.ok).toBe(true);
		expect(status.checks.find((check) => check.id === "uiautomator2")?.ok).toBe(true);
	});

	test("ensure server listens on 4723 and reuses that process", async () => {
		const runtime = createAppiumRuntime(systemHost(world({ drivers: { ...pinned } })));

		const port = await runtime.ensureServer();
		const again = await runtime.ensureServer();

		expect(port).toBe(4723);
		expect(again).toBe(4723);
		expect(runtime.managedInfo()).toMatchObject({
			id: "appium-managed-4723",
			pid: 4242,
			port: 4723,
			status: "running",
		});
	});

	test("ensure server uses the next free port when 4723 is taken", async () => {
		const disk = world({ drivers: { ...pinned } });
		disk.busyPorts.add(4723);
		const runtime = createAppiumRuntime(systemHost(disk));

		const port = await runtime.ensureServer();

		expect(port).toBe(4724);
	});
});
