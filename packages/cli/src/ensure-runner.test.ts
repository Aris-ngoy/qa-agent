import { describe, expect, test } from "bun:test";
import { pathToFileURL } from "node:url";
import {
	BUN_MISSING_MESSAGE,
	type EnsureRunnerDeps,
	RUNNER_NOT_FOUND_MESSAGE,
	type ResolveLaunchDeps,
	type RunnerLaunch,
	commandChainIncludes,
	ensureRunner,
	isRunnerHealth,
	packagedYoqaRunnerCandidates,
	resolveRunnerLaunch,
	runnerBaseUrlFromEnv,
	shouldSkipAutostart,
	stopOwnedRunner,
} from "./ensure-runner";

function launchDeps(
	overrides: Partial<ResolveLaunchDeps> & { files?: Set<string> } = {},
): ResolveLaunchDeps {
	const files = overrides.files ?? new Set<string>();
	return {
		env: overrides.env ?? {},
		cwd: overrides.cwd ?? "/tmp/app",
		execPath: overrides.execPath ?? "/usr/bin/node",
		argv0: overrides.argv0 ?? "node",
		homedir: overrides.homedir ?? "/tmp/home",
		fromUrl: overrides.fromUrl ?? pathToFileURL("/tmp/app/cli.js").href,
		pathExists: overrides.pathExists ?? (async (path) => files.has(path)),
		which: overrides.which ?? (async () => null),
		findBun: overrides.findBun ?? (async () => "/usr/bin/bun"),
		resolvePackageEntry: overrides.resolvePackageEntry ?? (async () => null),
	};
}

describe("packagedYoqaRunnerCandidates", () => {
	test("includes MacOS and Resources layouts", () => {
		const paths = packagedYoqaRunnerCandidates(["/Apps/Yoqa.app/Contents/MacOS"]);
		expect(paths).toContain("/Apps/Yoqa.app/Contents/MacOS/yoqa-runner");
		expect(paths).toContain(
			"/Apps/Yoqa.app/Contents/Resources/app.asar.unpacked/runner/yoqa-runner",
		);
		expect(paths).toContain("/Apps/Yoqa.app/Contents/Resources/runner/yoqa-runner");
	});
});

describe("isRunnerHealth", () => {
	test("accepts a healthy payload", () => {
		expect(isRunnerHealth({ ok: true, service: "yoqa-runner", version: "0.3.11" })).toBe(true);
	});

	test("rejects invalid payloads", () => {
		expect(isRunnerHealth(null)).toBe(false);
		expect(isRunnerHealth({ ok: true, service: "other", version: "1" })).toBe(false);
		expect(isRunnerHealth({ ok: true, service: "yoqa-runner" })).toBe(false);
	});
});

describe("shouldSkipAutostart", () => {
	test("is true for 1/true/yes", () => {
		expect(shouldSkipAutostart({ YOQA_NO_AUTOSTART: "1" })).toBe(true);
		expect(shouldSkipAutostart({ YOQA_NO_AUTOSTART: "true" })).toBe(true);
		expect(shouldSkipAutostart({ YOQA_NO_AUTOSTART: "YES" })).toBe(true);
		expect(shouldSkipAutostart({})).toBe(false);
	});
});

describe("runnerBaseUrlFromEnv", () => {
	test("prefers YOQA_RUNNER_URL", () => {
		expect(runnerBaseUrlFromEnv({ YOQA_RUNNER_URL: "http://127.0.0.1:9000/" })).toBe(
			"http://127.0.0.1:9000",
		);
	});
});

describe("resolveRunnerLaunch", () => {
	test("YOQA_RUNNER_BIN wins", async () => {
		const launch = await resolveRunnerLaunch(
			launchDeps({
				env: { YOQA_RUNNER_BIN: "/opt/yoqa-runner" },
				files: new Set(["/opt/yoqa-runner"]),
			}),
		);
		expect(launch).toEqual({ command: ["/opt/yoqa-runner"], source: "env" });
	});

	test("uses yoqa-runner on PATH", async () => {
		const launch = await resolveRunnerLaunch(
			launchDeps({
				which: async (bin) => (bin === "yoqa-runner" ? "/usr/local/bin/yoqa-runner" : null),
			}),
		);
		expect(launch).toEqual({ command: ["/usr/local/bin/yoqa-runner"], source: "path" });
	});

	test("uses packaged desktop sidecar", async () => {
		const packaged = "/Apps/Yoqa.app/Contents/MacOS/yoqa-runner";
		const launch = await resolveRunnerLaunch(
			launchDeps({
				execPath: "/Apps/Yoqa.app/Contents/MacOS/Yoqa",
				argv0: "Yoqa",
				files: new Set([packaged]),
			}),
		);
		expect(launch).toEqual({ command: [packaged], source: "packaged" });
	});

	test("uses monorepo source when the marker exists", async () => {
		const marker = "/repo/services/runner/src/index.ts";
		const launch = await resolveRunnerLaunch(
			launchDeps({
				cwd: "/repo/packages/cli",
				files: new Set([marker]),
			}),
		);
		expect(launch.source).toBe("monorepo");
		expect(launch.command).toEqual(["/usr/bin/bun", "run", marker]);
		expect(launch.cwd).toBe("/repo/services/runner");
	});

	test("uses published package entry when no repo is present", async () => {
		const entry = "/usr/lib/node_modules/@yoqa/runner/dist/index.js";
		const launch = await resolveRunnerLaunch(
			launchDeps({
				files: new Set([entry]),
				resolvePackageEntry: async () => entry,
			}),
		);
		expect(launch).toEqual({ command: ["/usr/bin/bun", entry], source: "package" });
	});

	test("throws when Bun is missing for a package launch", async () => {
		const entry = "/usr/lib/node_modules/@yoqa/runner/dist/index.js";
		await expect(
			resolveRunnerLaunch(
				launchDeps({
					files: new Set([entry]),
					findBun: async () => null,
					resolvePackageEntry: async () => entry,
				}),
			),
		).rejects.toMatchObject({ message: BUN_MISSING_MESSAGE });
	});

	test("throws when nothing can be resolved", async () => {
		await expect(resolveRunnerLaunch(launchDeps())).rejects.toMatchObject({
			message: RUNNER_NOT_FOUND_MESSAGE,
		});
	});
});

describe("ensureRunner", () => {
	function ensureDeps(
		overrides: Partial<EnsureRunnerDeps> & { files?: Set<string> } = {},
	): Partial<EnsureRunnerDeps> {
		const { files, ...rest } = overrides;
		const base = launchDeps({ ...rest, files });
		let pid: number | null = null;
		return {
			...base,
			fetchHealth: async () => null,
			spawnDetached: () => {
				throw new Error("should not spawn");
			},
			spawnForeground: () => {
				throw new Error("should not spawn");
			},
			writePid: async (next) => {
				pid = next;
			},
			readPid: async () => pid,
			removePid: async () => {
				pid = null;
			},
			isPidAlive: () => pid != null,
			killPid: () => {
				pid = null;
			},
			sleep: async () => {},
			now: () => 0,
			log: () => {},
			...rest,
		};
	}

	test("already healthy does not spawn", async () => {
		let spawned = 0;
		const result = await ensureRunner({
			mode: "detached",
			deps: ensureDeps({
				fetchHealth: async () => ({ ok: true, service: "yoqa-runner", version: "0.3.11" }),
				spawnDetached: () => {
					spawned += 1;
					return { pid: 99 };
				},
			}),
		});
		expect(result.started).toBe(false);
		expect(spawned).toBe(0);
	});

	test("detached spawn waits for health then returns", async () => {
		let spawned: RunnerLaunch | null = null;
		let fetches = 0;
		const result = await ensureRunner({
			mode: "detached",
			deps: ensureDeps({
				env: { YOQA_RUNNER_BIN: "/opt/yoqa-runner" },
				files: new Set(["/opt/yoqa-runner"]),
				fetchHealth: async () => {
					fetches += 1;
					if (fetches < 2) return null;
					return { ok: true, service: "yoqa-runner", version: "0.3.11" };
				},
				spawnDetached: (launch) => {
					spawned = launch;
					return { pid: 42 };
				},
				now: (() => {
					let t = 0;
					return () => {
						t += 1;
						return t;
					};
				})(),
			}),
		});
		expect(result.started).toBe(true);
		expect(result.pid).toBe(42);
		expect(spawned?.source).toBe("env");
	});
});

describe("stopOwnedRunner", () => {
	test("no pid file is a no-op", async () => {
		const result = await stopOwnedRunner({
			readPid: async () => null,
			removePid: async () => {},
			isPidAlive: () => false,
			killPid: () => {
				throw new Error("should not kill");
			},
			log: () => {},
		});
		expect(result.ok).toBe(true);
		expect(result.message).toContain("No yoqa-owned");
	});
});

describe("commandChainIncludes", () => {
	test("walks parent names", () => {
		const leaf = {
			name: () => "ios",
			parent: { name: () => "devices", parent: { name: () => "yoqa" } },
		};
		expect(commandChainIncludes(leaf, "serve")).toBe(false);
		expect(commandChainIncludes({ name: () => "serve" }, "serve")).toBe(true);
	});
});
