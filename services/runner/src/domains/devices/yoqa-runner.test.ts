import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type RunnerProcess,
	type YoqaRunnerDeps,
	YoqaRunnerError,
	prepareYoqaRunner,
	startYoqaRunner,
} from "./yoqa-runner";

// The signing fixtures have the shape of `security find-identity -v -p codesigning` and
// `security find-certificate -a -Z -p -c "Apple Development"`, with synthetic certificates:
// an older and a newer identity, a newest one that is revoked, and a newest certificate whose
// private key is not in the keychain. The team is each certificate's OU.

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const findIdentity = fixture("security-find-identity.txt");
const findCertificate = fixture("security-find-certificate.txt");

const UDID = "00008120-000E6D813E2A601E";
const OTHER_UDID = "00008150-000504A22638401C";
const NOW = new Date("2026-10-10T10:00:00Z");

type Result = { stdout: string; stderr: string; exitCode: number };

/**
 * A Mac at the commands the runner build uses: the keychain, `xcodebuild -version`, and an
 * `xcodebuild build-for-testing` that writes an `.xctestrun` and a provisioning profile into
 * the derived data path (or fails with `buildFailure`). `security cms` decodes that profile.
 */
function fakeMac() {
	const mac = {
		identities: findIdentity,
		certificates: findCertificate,
		xcodeVersion: "Xcode 27.0\nBuild version 27A266a",
		profileDays: 7,
		profileDevices: [UDID],
		buildFailure: null as string | null,
		builds: [] as Array<{ team?: string; udid?: string }>,
	};
	const profiles = new Map<string, { expires: Date; devices: string[] }>();

	const exec: YoqaRunnerDeps["exec"] = async (command) => {
		const ok = (stdout: string): Result => ({ stdout, stderr: "", exitCode: 0 });
		const [tool, ...args] = command;
		if (tool === "security" && args[0] === "find-identity") return ok(mac.identities);
		if (tool === "security" && args[0] === "find-certificate") return ok(mac.certificates);
		if (tool === "security" && args[0] === "cms") {
			const profile = profiles.get(args[args.indexOf("-i") + 1] ?? "");
			if (!profile) return { stdout: "", stderr: "no such file", exitCode: 1 };
			return ok(profilePlist(profile.expires, profile.devices));
		}
		if (tool === "xcodebuild" && args[0] === "-version") return ok(mac.xcodeVersion);
		if (tool === "xcodebuild" && args.includes("build-for-testing")) {
			const setting = (name: string) =>
				args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
			const destination = args[args.indexOf("-destination") + 1];
			mac.builds.push({
				team: setting("DEVELOPMENT_TEAM"),
				udid: destination?.replace(/^id=/, ""),
			});
			if (mac.buildFailure) return { stdout: mac.buildFailure, stderr: "", exitCode: 65 };
			const products = join(args[args.indexOf("-derivedDataPath") + 1] ?? "", "Build/Products");
			for (const app of ["YoqaRunner.app", "YoqaRunnerUITests-Runner.app"]) {
				await mkdir(join(products, "Debug-iphoneos", app), { recursive: true });
				const path = join(products, "Debug-iphoneos", app, "embedded.mobileprovision");
				await writeFile(path, "profile");
				profiles.set(path, {
					expires: new Date(NOW.getTime() + mac.profileDays * 86_400_000),
					devices: [...mac.profileDevices],
				});
			}
			await writeFile(join(products, "YoqaRunner_iphoneos27.0-arm64.xctestrun"), "<plist/>");
			return ok("** TEST BUILD SUCCEEDED **");
		}
		return { stdout: "", stderr: `unexpected command: ${command.join(" ")}`, exitCode: 127 };
	};
	return { mac, exec };
}

function profilePlist(expires: Date, devices: string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
	<key>ExpirationDate</key>
	<date>${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}</date>
	<key>ProvisionedDevices</key>
	<array>${devices.map((udid) => `<string>${udid}</string>`).join("")}</array>
</dict></plist>`;
}

const cleanup: string[] = [];
afterEach(async () => {
	for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(env: Record<string, string> = {}) {
	const root = await mkdtemp(join(tmpdir(), "yoqa-runner-test-"));
	cleanup.push(root);
	const projectDir = join(root, "project");
	await mkdir(join(projectDir, "YoqaRunnerUITests"), { recursive: true });
	await writeFile(join(projectDir, "YoqaRunnerUITests/RunnerTests.swift"), "// v1");
	const { mac, exec } = fakeMac();
	const deps: YoqaRunnerDeps = {
		exec,
		env,
		projectDir,
		cacheRoot: join(root, "cache"),
		now: () => NOW,
	};
	return { mac, deps, projectDir };
}

describe("prepareYoqaRunner", () => {
	test("signs with the team of the newest Apple Development identity in the keychain", async () => {
		const { mac, deps } = await setup();
		const build = await prepareYoqaRunner(UDID, deps);
		expect(build.team).toBe("NEWTEAM222");
		expect(build.action).toBe("built");
		expect(mac.builds).toEqual([{ team: "NEWTEAM222", udid: UDID }]);
	});

	test("YOQA_IOS_TEAM_ID overrides the keychain", async () => {
		const { deps } = await setup({ YOQA_IOS_TEAM_ID: "PICKED9999" });
		expect((await prepareYoqaRunner(UDID, deps)).team).toBe("PICKED9999");
	});

	test("a lower-case YOQA_IOS_TEAM_ID is the same team", async () => {
		const { deps } = await setup({ YOQA_IOS_TEAM_ID: " picked9999 " });
		expect((await prepareYoqaRunner(UDID, deps)).team).toBe("PICKED9999");
	});

	test("without a working xcodebuild it says so instead of building", async () => {
		const { mac, deps } = await setup();
		mac.xcodeVersion = "";
		const exec = deps.exec;
		deps.exec = async (command, ...rest) =>
			command.join(" ") === "xcodebuild -version"
				? {
						stdout: "",
						stderr: "xcode-select: error: tool 'xcodebuild' requires Xcode",
						exitCode: 1,
					}
				: exec(command, ...rest);
		await expect(prepareYoqaRunner(UDID, deps)).rejects.toThrow(/requires Xcode/);
		expect(mac.builds).toEqual([]);
	});

	test("without a signing identity it says how to get one", async () => {
		const { mac, deps } = await setup();
		mac.identities = "     0 valid identities found\n";
		const failure = prepareYoqaRunner(UDID, deps);
		await expect(failure).rejects.toBeInstanceOf(YoqaRunnerError);
		await expect(failure).rejects.toThrow(/Xcode › Settings › Accounts.*YOQA_IOS_TEAM_ID/);
		expect(mac.builds).toEqual([]);
	});

	test("a second connect reuses the cached build", async () => {
		const { mac, deps } = await setup();
		const first = await prepareYoqaRunner(UDID, deps);
		const second = await prepareYoqaRunner(UDID, deps);
		expect(second).toEqual({ ...first, action: "reused" });
		expect(second.xctestrun).toEndWith(".xctestrun");
		expect(mac.builds).toHaveLength(1);
	});

	test("changing the team or the Xcode version rebuilds", async () => {
		const { mac, deps } = await setup();
		await prepareYoqaRunner(UDID, deps);
		mac.xcodeVersion = "Xcode 27.1\nBuild version 27B100";
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("built");
		deps.env = { YOQA_IOS_TEAM_ID: "PICKED9999" };
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("built");
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("reused");
	});

	test("changing the runner source rebuilds", async () => {
		const { deps, projectDir } = await setup();
		await prepareYoqaRunner(UDID, deps);
		await writeFile(join(projectDir, "YoqaRunnerUITests/RunnerTests.swift"), "// v2");
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("built");
	});

	test("an expired free profile rebuilds on the next connect", async () => {
		const { mac, deps } = await setup();
		await prepareYoqaRunner(UDID, deps);
		mac.profileDays = 14;
		deps.now = () => new Date(NOW.getTime() + 8 * 86_400_000);
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("built");
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("reused");
	});

	test("a phone the profile does not list rebuilds, so it gets registered", async () => {
		const { mac, deps } = await setup();
		await prepareYoqaRunner(UDID, deps);
		mac.profileDevices = [UDID, OTHER_UDID];
		expect((await prepareYoqaRunner(OTHER_UDID, deps)).action).toBe("built");
		expect(mac.builds.at(-1)?.udid).toBe(OTHER_UDID);
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("reused");
	});

	test.each([
		[
			"no account for the team",
			`/x/YoqaRunner.xcodeproj: error: No Account for Team "NEWTEAM222". Add a new account in Accounts settings or verify that your accounts have valid credentials. (in target 'YoqaRunner' from project 'YoqaRunner')`,
			/NEWTEAM222.*Xcode › Settings › Accounts.*YOQA_IOS_TEAM_ID/,
		],
		[
			"no Apple account in Xcode at all (Xcode 27)",
			`/x/YoqaRunner.xcodeproj: error: No Accounts: Add a new account in Accounts settings. (in target 'YoqaRunnerUITests' from project 'YoqaRunner')
/x/YoqaRunner.xcodeproj: error: No profiles for 'dev.yoqa.runner.newteam222.uitests.xctrunner' were found: Xcode couldn't find any iOS App Development provisioning profiles matching 'dev.yoqa.runner.newteam222.uitests.xctrunner'. (in target 'YoqaRunnerUITests' from project 'YoqaRunner')`,
			/No Accounts.*Xcode has no account for team NEWTEAM222.*Xcode › Settings › Accounts/,
		],
		[
			"a bundle ID another team owns",
			`/x/YoqaRunner.xcodeproj: error: Failed Registering Bundle Identifier: The app identifier "dev.yoqa.runner.newteam222" cannot be registered to your development team because it is not available. Change your bundle identifier to a unique string to try again. (in target 'YoqaRunner' from project 'YoqaRunner')`,
			/dev\.yoqa\.runner\.newteam222.*not available/,
		],
		[
			"a locked phone",
			"xcodebuild: error: Unable to find a destination matching the provided destination specifier:\n\t\t{ id:00008120-000E6D813E2A601E }\n\tReason: Xcode cannot launch on the iPhone because the device is locked.",
			/Unlock the iPhone/,
		],
		[
			"Developer Mode off",
			"error: Developer Mode disabled. To use this device for development, enable Developer Mode in Settings → Privacy & Security.",
			/Developer Mode/,
		],
	])("a signing failure (%s) says what to fix", async (_, output, fix) => {
		const { mac, deps } = await setup();
		mac.buildFailure = `Command line invocation:\n    xcodebuild build-for-testing\n${output}\n** TEST BUILD FAILED **`;
		const failure = prepareYoqaRunner(UDID, deps);
		await expect(failure).rejects.toBeInstanceOf(YoqaRunnerError);
		await expect(failure).rejects.toThrow(fix);
		mac.buildFailure = null;
		expect((await prepareYoqaRunner(UDID, deps)).action).toBe("built");
	});
});

type Launch = { command: string[]; env: Record<string, string> };

/**
 * `xcodebuild test-without-building` at what the Mac reads from it: its output, ending in the
 * runner's `YOQA_RUNNER_LISTENING port=N` (on `TEST_RUNNER_YOQA_RUNNER_PORT` when given), or
 * `exit` with output and no line, or `silent`.
 */
function fakeXcodebuildTest(mode: { exit?: string; silent?: boolean; waiting?: string } = {}) {
	const launches: Launch[] = [];
	let kills = 0;
	const spawn = (command: string[], env: Record<string, string>): RunnerProcess => {
		launches.push({ command, env });
		const encoder = new TextEncoder();
		let exit: (code: number) => void = () => undefined;
		const exited = new Promise<number>((resolve) => {
			exit = resolve;
		});
		const stdout = new ReadableStream<Uint8Array>({
			start: (controller) => {
				controller.enqueue(
					encoder.encode(
						"Test Suite 'All tests' started\nTest Case '-[RunnerTests testRun]' started.\n",
					),
				);
				if (mode.exit !== undefined) {
					controller.enqueue(encoder.encode(`${mode.exit}\n`));
					controller.close();
					exit(65);
				} else if (mode.waiting !== undefined) {
					controller.enqueue(encoder.encode(`${mode.waiting}\n`));
				} else if (!mode.silent) {
					const port = env.TEST_RUNNER_YOQA_RUNNER_PORT ?? "50123";
					controller.enqueue(encoder.encode(`YOQA_RUNNER_LISTENING port=${port}\n`));
				}
			},
		});
		return {
			stdout,
			exited,
			kill: () => {
				kills++;
				exit(143);
			},
		};
	};
	return { spawn, launches, kills: () => kills };
}

describe("startYoqaRunner", () => {
	test("starts the runner on the phone and reads its port from the log", async () => {
		const { deps } = await setup();
		const xcodebuild = fakeXcodebuildTest();
		const runner = await startYoqaRunner(UDID, { ...deps, spawn: xcodebuild.spawn });
		expect(runner.port).toBe(50123);
		expect(runner.build.action).toBe("built");
		expect(xcodebuild.launches[0]?.command).toContain(`id=${UDID}`);
		await runner.stop();
		await runner.stop();
		expect(xcodebuild.kills()).toBe(1);
	});

	test("a requested port reaches the runner", async () => {
		const { deps } = await setup({ YOQA_RUNNER_PORT: "8100" });
		const runner = await startYoqaRunner(UDID, { ...deps, spawn: fakeXcodebuildTest().spawn });
		expect(runner.port).toBe(8100);
		await runner.stop();
	});

	test("a runner that exits before listening says why", async () => {
		const { deps } = await setup();
		const xcodebuild = fakeXcodebuildTest({
			exit: "Xcode cannot launch YoqaRunnerUITests on the iPhone because the device is locked.",
		});
		const failure = startYoqaRunner(UDID, { ...deps, spawn: xcodebuild.spawn });
		await expect(failure).rejects.toBeInstanceOf(YoqaRunnerError);
		await expect(failure).rejects.toThrow(/Unlock the iPhone/);
	});

	test("a runner that never listens times out and is stopped", async () => {
		const { deps } = await setup();
		const xcodebuild = fakeXcodebuildTest({ silent: true });
		await expect(
			startYoqaRunner(UDID, { ...deps, spawn: xcodebuild.spawn, readyTimeoutMs: 50 }),
		).rejects.toThrow(/YOQA_RUNNER_LISTENING/);
		expect(xcodebuild.kills()).toBe(1);
	});

	test("a phone that stays locked times out with the fix", async () => {
		const { deps } = await setup();
		const xcodebuild = fakeXcodebuildTest({
			waiting: `Error Domain=com.apple.dt.deviceprep Code=-3 "Unlock Test’s iPhone to Continue"\nRun Destination Preflight: Waiting for the destination to become ready.`,
		});
		await expect(
			startYoqaRunner(UDID, { ...deps, spawn: xcodebuild.spawn, readyTimeoutMs: 50 }),
		).rejects.toThrow(
			/YOQA_RUNNER_LISTENING within 50 ms for team NEWTEAM222: Unlock Test’s iPhone to Continue\. Unlock the iPhone/,
		);
	});
});
