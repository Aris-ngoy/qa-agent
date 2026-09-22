import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ArgentError } from "./cli";
import * as actualCli from "./cli";

type ToolCall = { tool: string; args: string[] };

let toolCalls: ToolCall[] = [];
let listDevicesPayload: unknown = { devices: [{ udid: "sim-1" }] };
let listDevicesError: unknown = null;
let launchError: unknown = null;
let openUrlError: unknown = null;
let describePayload: unknown = { description: "", source: "test" };
let describeError: unknown = null;
let screenshotPayload: unknown = null;
let screenshotError: unknown = null;
let awaitPayload: unknown = { success: true, elapsed: 120 };
let toolErrors: Record<string, unknown> = {};

// Stub the Argent backend so no `argent` binary is needed.
mock.module("./cli", () => ({
	...actualCli,
	runArgentTool: async (toolName: string, args: string[] = []) => {
		toolCalls.push({ tool: toolName, args: [...args] });
		if (toolName in toolErrors) throw toolErrors[toolName];
		if (toolName === "list-devices") {
			if (listDevicesError) throw listDevicesError;
			return listDevicesPayload;
		}
		if (toolName === "launch-app") {
			if (launchError) throw launchError;
			return { ok: true };
		}
		if (toolName === "open-url") {
			if (openUrlError) throw openUrlError;
			return { ok: true };
		}
		if (toolName === "describe") {
			if (describeError) throw describeError;
			return describePayload;
		}
		if (toolName === "screenshot") {
			if (screenshotError) throw screenshotError;
			return screenshotPayload;
		}
		if (toolName === "await-ui-element") return awaitPayload;
		return { ok: true };
	},
}));

const { createArgentDeviceSession, resetArgentSessionsForTests } = await import("./session");
const { resetArgentScreenForTests } = await import("./screen");
const { DeadSessionError } = await import("../devices/session");

beforeEach(() => {
	toolCalls = [];
	listDevicesPayload = { devices: [{ udid: "sim-1" }] };
	listDevicesError = null;
	launchError = null;
	openUrlError = null;
	describePayload = { description: "", source: "test" };
	describeError = null;
	screenshotPayload = null;
	screenshotError = null;
	awaitPayload = { success: true, elapsed: 120 };
	toolErrors = {};
	resetArgentSessionsForTests();
	resetArgentScreenForTests();
});

function launchCalls(): ToolCall[] {
	return toolCalls.filter((call) => call.tool === "launch-app");
}

describe("createArgentDeviceSession connect", () => {
	test("validates via list-devices, then launches the default iOS target", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		expect(toolCalls[0]?.tool).toBe("list-devices");
		expect(launchCalls()).toHaveLength(1);
		expect(launchCalls()[0]?.args).toEqual([
			"--udid",
			"sim-1",
			"--bundleId",
			"com.apple.Preferences",
		]);
		expect(session.target).toBe("com.apple.Preferences");
		await session.quit();
	});

	test("launches the requested bundleId on iOS", async () => {
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "sim-1",
			bundleId: "com.example.app",
		});

		expect(launchCalls()[0]?.args).toContain("com.example.app");
		expect(session.target).toBe("com.example.app");
		await session.quit();
	});

	test("defaults to Settings and passes --activity through on Android", async () => {
		listDevicesPayload = { devices: [{ udid: "emu-1" }] };

		const plain = await createArgentDeviceSession({ platform: "android", deviceId: "emu-1" });
		expect(launchCalls()[0]?.args).toEqual([
			"--udid",
			"emu-1",
			"--bundleId",
			"com.android.settings",
		]);
		await plain.quit();

		resetArgentSessionsForTests();
		const withActivity = await createArgentDeviceSession({
			platform: "android",
			deviceId: "emu-1",
			appPackage: "com.example.app",
			activity: ".MainActivity",
		});
		expect(launchCalls()[1]?.args).toEqual([
			"--udid",
			"emu-1",
			"--bundleId",
			"com.example.app",
			"--activity",
			".MainActivity",
		]);
		expect(withActivity.target).toBe("com.example.app");
		await withActivity.quit();
	});

	test("throws an actionable error for an unknown device", async () => {
		listDevicesPayload = { devices: [{ udid: "sim-1" }] };

		const error = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "nope",
		}).then(
			() => null,
			(error: unknown) => error,
		);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(
			"Device not found: nope. List devices with: yoqa devices ios",
		);
		expect(launchCalls()).toHaveLength(0);
	});
});

describe("argent session registry", () => {
	test("a second connect replaces the first; stale quit is harmless", async () => {
		const first = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		const second = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		expect(second).not.toBe(first);
		expect(launchCalls()).toHaveLength(2);

		// The replaced session must not disturb the live one.
		await first.quit();
		await second.activateApp("com.apple.Preferences");
		expect(launchCalls()).toHaveLength(3);
		await second.quit();

		// Registry released — a fresh connect works.
		await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" }).then((s) => s.quit());
		expect(launchCalls()).toHaveLength(4);
	});

	test("quit performs no tool calls and never stops simulator servers", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		await session.activateApp("com.apple.Preferences");
		const callsBeforeQuit = toolCalls.length;

		await session.quit();
		await session.quit();

		expect(toolCalls).toHaveLength(callsBeforeQuit);
		expect(toolCalls.some((call) => call.tool === "stop-all-simulator-servers")).toBe(false);
	});
});

describe("argent dead-session mapping", () => {
	test("a dead device notifies once and surfaces DeadSessionError", async () => {
		const onSessionDead = mock(() => undefined);
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "sim-1",
			onSessionDead,
		});

		openUrlError = new ArgentError("device disconnected", "DEVICE_DISCONNECTED");
		await expect(session.openUrl("https://example.com")).rejects.toBeInstanceOf(DeadSessionError);
		await expect(session.openUrl("https://example.com")).rejects.toBeInstanceOf(DeadSessionError);
		expect(onSessionDead).toHaveBeenCalledTimes(1);
		await session.quit();
	});

	test("a down tool-server maps to DeadSessionError via the transport message", async () => {
		const onSessionDead = mock(() => undefined);
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "sim-1",
			onSessionDead,
		});

		openUrlError = new Error("connect ECONNREFUSED 127.0.0.1:55598 — tool-server down?");
		await expect(session.openUrl("https://example.com")).rejects.toBeInstanceOf(DeadSessionError);
		expect(onSessionDead).toHaveBeenCalledTimes(1);
		await session.quit();
	});
});

describe("physical-iPhone single-app guard", () => {
	test("cross-app activateApp throws; same app and springboard stay allowed", async () => {
		listDevicesPayload = { devices: [{ udid: "iphone-1" }] };
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "iphone-1",
			kind: "physical",
			bundleId: "com.example.app",
		});
		const launchesBefore = launchCalls().length;

		const error = await session.activateApp("com.other.app").then(
			() => null,
			(error: unknown) => error,
		);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("single-app scoped");
		expect((error as Error).message).toContain("launch-app com.other.app");
		expect(launchCalls()).toHaveLength(launchesBefore);

		await session.activateApp("com.example.app");
		await session.activateApp("com.apple.springboard");
		expect(launchCalls()).toHaveLength(launchesBefore + 2);
		await session.quit();
	});

	test("openUrl with a foreign bundleId throws; plain openUrl stays in scope", async () => {
		listDevicesPayload = { devices: [{ udid: "iphone-1" }] };
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "iphone-1",
			kind: "physical",
			bundleId: "com.example.app",
		});

		await session.openUrl("myapp://item/1");
		expect(toolCalls.some((call) => call.tool === "open-url")).toBe(true);

		const error = await session.openUrl("otherapp://item/1", { bundleId: "com.other.app" }).then(
			() => null,
			(error: unknown) => error,
		);
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain("single-app scoped");
		await session.quit();
	});

	test("simulators stay multi-app", async () => {
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "sim-1",
			kind: "simulator",
			bundleId: "com.example.app",
		});

		await session.activateApp("com.other.app");
		expect(session.target).toBe("com.other.app");
		await session.quit();
	});
});

describe("argent session screen", () => {
	const PNG_BASE64 =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

	async function writeTempPng(): Promise<string> {
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const path = join(tmpdir(), `yoqa-argent-session-${Date.now()}-${crypto.randomUUID()}.png`);
		await Bun.write(path, Buffer.from(PNG_BASE64, "base64"));
		return path;
	}

	test("snapshotNodes parses describe; getWindowSize returns the 1000x1000 window", async () => {
		describePayload = {
			description: 'AXButton "OK"  (0.5, 0.5, 0.2, 0.1)',
			source: "ios",
		};
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		const { nodes, window } = await session.snapshotNodes();
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({ role: "AXButton", label: "OK" });
		expect(window).toEqual({ width: 1000, height: 1000 });
		expect(await session.getWindowSize()).toEqual({ width: 1000, height: 1000 });
		await session.quit();
	});

	test("captureFrame and screenshot read the image path through the session guard", async () => {
		const { mkdtemp, rm } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const home = await mkdtemp(join(tmpdir(), "yoqa-home-"));
		const previousHome = process.env.HOME;
		process.env.HOME = home;
		const image = await writeTempPng();
		try {
			screenshotPayload = { image };
			const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

			const frame = await session.captureFrame();
			expect(frame.mime).toBe("image/png");
			expect(frame.base64).toBe(PNG_BASE64);

			const shot = await session.screenshot();
			expect(shot.path.startsWith(join(home, ".yoqa", "runs", "screenshots"))).toBe(true);
			expect(shot.base64).toBe(PNG_BASE64);
			await rm(shot.path, { force: true });
			await session.quit();
		} finally {
			await rm(image, { force: true });
			process.env.HOME = previousHome ?? tmpdir();
			await rm(home, { recursive: true, force: true });
		}
	});

	test("a dead describe notifies once and surfaces DeadSessionError", async () => {
		const onSessionDead = mock(() => undefined);
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "sim-1",
			onSessionDead,
		});

		describeError = new ArgentError("device disconnected", "DEVICE_DISCONNECTED");
		await expect(session.snapshotNodes()).rejects.toBeInstanceOf(DeadSessionError);
		await expect(session.getWindowSize()).rejects.toBeInstanceOf(DeadSessionError);
		expect(onSessionDead).toHaveBeenCalledTimes(1);
		await session.quit();
	});
});

describe("argent gestures", () => {
	function gestureCalls(tool: string): ToolCall[] {
		return toolCalls.filter((call) => call.tool === tool);
	}

	test("tap converts 0–1000 boundary coords to 0–1 fractions", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.tap(500, 250);

		expect(gestureCalls("gesture-tap")).toHaveLength(1);
		expect(gestureCalls("gesture-tap")[0]?.args).toEqual([
			"--udid",
			"sim-1",
			"--x",
			"0.5",
			"--y",
			"0.25",
		]);
		await session.quit();
	});

	test("tap with durationMs>=400 long-presses via gesture-custom", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.tap(500, 500, { durationMs: 800 });

		expect(gestureCalls("gesture-tap")).toHaveLength(0);
		const custom = gestureCalls("gesture-custom");
		expect(custom).toHaveLength(1);
		const events = JSON.parse(
			custom[0]?.args[custom[0]?.args.indexOf("--events-json") + 1] as string,
		) as Array<{ type: string; delayMs?: number }>;
		expect(events[0]?.type).toBe("Down");
		expect(events[1]).toMatchObject({ type: "Up", delayMs: 800 });
		await session.quit();
	});

	test("swipe passes fractions plus durationMs", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.swipe(100, 200, 300, 400, 500);

		expect(gestureCalls("gesture-swipe")).toHaveLength(1);
		expect(gestureCalls("gesture-swipe")[0]?.args).toEqual([
			"--udid",
			"sim-1",
			"--fromX",
			"0.1",
			"--fromY",
			"0.2",
			"--toX",
			"0.3",
			"--toY",
			"0.4",
			"--durationMs",
			"500",
		]);
		await session.quit();
	});

	test("drag is a momentum-free swipe for determinism", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.drag(100, 100, 900, 900);

		const swipe = gestureCalls("gesture-swipe");
		expect(swipe).toHaveLength(1);
		expect(swipe[0]?.args).toContain("--momentum");
		expect(swipe[0]?.args).toContain("false");
		await session.quit();
	});

	test("type sends plain text via keyboard", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.type("hello");

		const keyboard = gestureCalls("keyboard");
		expect(keyboard).toHaveLength(1);
		expect(keyboard[0]?.args).toEqual(["--udid", "sim-1", "--text", "hello"]);
		await session.quit();
	});

	test("type with a secret placeholder goes through a single run-sequence step", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.type("pass {{secret:APP_PASSWORD}}");

		expect(gestureCalls("keyboard")).toHaveLength(0);
		const sequence = gestureCalls("run-sequence");
		expect(sequence).toHaveLength(1);
		const steps = JSON.parse(
			sequence[0]?.args[sequence[0]?.args.indexOf("--steps-json") + 1] as string,
		) as Array<{ tool: string; args: { text: string } }>;
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({
			tool: "keyboard",
			args: { text: "pass {{secret:APP_PASSWORD}}" },
		});
		await session.quit();
	});

	test("type + newline is one run-sequence: text step then key enter", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.type("hello\n");

		expect(gestureCalls("keyboard")).toHaveLength(0);
		const sequence = gestureCalls("run-sequence");
		expect(sequence).toHaveLength(1);
		const steps = JSON.parse(
			sequence[0]?.args[sequence[0]?.args.indexOf("--steps-json") + 1] as string,
		) as Array<{ tool: string; args: { text?: string; key?: string } }>;
		expect(steps).toEqual([
			{ tool: "keyboard", args: { text: "hello" } },
			{ tool: "keyboard", args: { key: "enter" } },
		]);
		await session.quit();
	});

	test("type with a mid-text newline splits segments around enter keys", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.type("a\nb\n");

		const sequence = gestureCalls("run-sequence");
		expect(sequence).toHaveLength(1);
		const steps = JSON.parse(
			sequence[0]?.args[sequence[0]?.args.indexOf("--steps-json") + 1] as string,
		) as Array<{ tool: string; args: { text?: string; key?: string } }>;
		expect(steps).toEqual([
			{ tool: "keyboard", args: { text: "a" } },
			{ tool: "keyboard", args: { key: "enter" } },
			{ tool: "keyboard", args: { text: "b" } },
			{ tool: "keyboard", args: { key: "enter" } },
		]);
		await session.quit();
	});

	test("awaitScreenIdle calls await-screen-idle with the settle budget", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		toolCalls = [];

		await session.awaitScreenIdle(800);

		const idleCalls = toolCalls.filter((call) => call.tool === "await-screen-idle");
		expect(idleCalls.map((call) => call.args)).toEqual([
			["--udid", "sim-1", "--timeoutMs", "800", "--pollIntervalMs", "200", "--minStableMs", "250"],
		]);
		await session.quit();
	});

	test("keyboard dismiss|enter map to escape|enter keys", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.keyboard("dismiss");
		await session.keyboard("enter");

		const keyboard = gestureCalls("keyboard");
		expect(keyboard).toHaveLength(2);
		expect(keyboard[0]?.args).toEqual(["--udid", "sim-1", "--key", "escape"]);
		expect(keyboard[1]?.args).toEqual(["--udid", "sim-1", "--key", "enter"]);
		await session.quit();
	});

	test("back presses the hardware back button", async () => {
		const session = await createArgentDeviceSession({
			platform: "android",
			deviceId: "sim-1",
		});

		await session.back();

		const button = gestureCalls("button");
		expect(button).toHaveLength(1);
		expect(button[0]?.args).toEqual(["--udid", "sim-1", "--button", "back"]);
		await session.quit();
	});

	test("back on iOS rejection throws an actionable error", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		toolErrors.button = new Error("Button 'back' is not supported on this device");

		await expect(session.back()).rejects.toThrow(/not supported on iOS/);
		await session.quit();
	});

	test("scroll defaults to one momentum-free swipe; large amounts cap at three", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.scroll("down");
		expect(gestureCalls("gesture-swipe")).toHaveLength(1);
		expect(gestureCalls("gesture-swipe")[0]?.args).toContain("false");

		toolCalls = [];
		await session.scroll("up", 5);
		expect(gestureCalls("gesture-swipe")).toHaveLength(3);
		await session.quit();
	});

	test("a dead gesture notifies once and surfaces DeadSessionError", async () => {
		const onSessionDead = mock(() => undefined);
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "sim-1",
			onSessionDead,
		});

		toolErrors["gesture-tap"] = new ArgentError("device disconnected", "DEVICE_DISCONNECTED");
		await expect(session.tap(500, 500)).rejects.toBeInstanceOf(DeadSessionError);
		await expect(session.tap(500, 500)).rejects.toBeInstanceOf(DeadSessionError);
		expect(onSessionDead).toHaveBeenCalledTimes(1);
		await session.quit();
	});
});

describe("argent lifecycle", () => {
	function toolArgs(tool: string): string[][] {
		return toolCalls.filter((call) => call.tool === tool).map((call) => call.args);
	}

	test("home presses the hardware home button", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.home();

		expect(toolArgs("button")).toEqual([["--udid", "sim-1", "--button", "home"]]);
		await session.quit();
	});

	test("backgroundApp presses home then relaunches the current target", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		await session.activateApp("com.example.app");
		toolCalls = [];

		await session.backgroundApp(0);

		expect(toolArgs("button")).toEqual([["--udid", "sim-1", "--button", "home"]]);
		expect(toolArgs("launch-app")).toEqual([["--udid", "sim-1", "--bundleId", "com.example.app"]]);
		await session.quit();
	});

	test("terminateApp calls terminate-app and surfaces Argent's tool-not-found with a restart-app hint", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		toolCalls = [];
		toolErrors["terminate-app"] = new ArgentError(
			'Tool "terminate-app" not found. Run `argent tools` to list available tools.',
			"COMMAND_FAILED",
		);

		await expect(session.terminateApp("com.example.app")).rejects.toThrow(
			/use restartApp\(appId\)/,
		);
		expect(toolArgs("terminate-app")).toEqual([
			["--udid", "sim-1", "--bundleId", "com.example.app"],
		]);
		await session.quit();
	});

	test("restartApp relaunches by bundleId and retargets the session", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.restartApp("com.example.app");

		expect(toolArgs("restart-app")).toEqual([["--udid", "sim-1", "--bundleId", "com.example.app"]]);
		expect(session.target).toBe("com.example.app");
		await session.quit();
	});

	test("restartApp passes --activity through on Android", async () => {
		listDevicesPayload = { devices: [{ udid: "emu-1" }] };
		const session = await createArgentDeviceSession({
			platform: "android",
			deviceId: "emu-1",
			appPackage: "com.example.app",
			activity: ".MainActivity",
		});
		toolCalls = [];

		await session.restartApp("com.example.app");

		expect(toolArgs("restart-app")).toEqual([
			["--udid", "emu-1", "--bundleId", "com.example.app", "--activity", ".MainActivity"],
		]);
		await session.quit();
	});

	test("restartApp of a foreign app stays blocked on a physical iPhone", async () => {
		listDevicesPayload = { devices: [{ udid: "iphone-1" }] };
		const session = await createArgentDeviceSession({
			platform: "ios",
			deviceId: "iphone-1",
			kind: "physical",
			bundleId: "com.example.app",
		});
		toolCalls = [];

		await expect(session.restartApp("com.other.app")).rejects.toThrow(/single-app scoped/);
		expect(toolArgs("restart-app")).toHaveLength(0);
		await session.quit();
	});

	test("reinstallApp passes bundleId and appPath", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.reinstallApp("./build/MyApp.app", "com.example.app");

		expect(toolArgs("reinstall-app")).toEqual([
			["--udid", "sim-1", "--bundleId", "com.example.app", "--appPath", "./build/MyApp.app"],
		]);
		await session.quit();
	});

	test("reinstallApp validates its inputs without tool calls", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		toolCalls = [];

		await expect(session.reinstallApp("", "com.example.app")).rejects.toThrow(/appPath/);
		await expect(session.reinstallApp("./build/MyApp.app", "")).rejects.toThrow(/bundleId/);
		expect(toolCalls).toHaveLength(0);
		await session.quit();
	});
});

describe("argent alerts", () => {
	function tapArgs(): string[][] {
		return toolCalls.filter((call) => call.tool === "gesture-tap").map((call) => call.args);
	}

	test("acceptAlert taps the center of the OK button", async () => {
		describePayload = {
			description: 'AXButton "OK"  (0.4, 0.5, 0.2, 0.1)\nAXButton "Cancel"  (0.4, 0.7, 0.2, 0.1)',
			source: "ios",
		};
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.acceptAlert();

		expect(tapArgs()).toEqual([["--udid", "sim-1", "--x", "0.5", "--y", "0.55"]]);
		await session.quit();
	});

	test("dismissAlert taps the Cancel button", async () => {
		describePayload = {
			description: 'AXButton "OK"  (0.4, 0.5, 0.2, 0.1)\nAXButton "Cancel"  (0.4, 0.7, 0.2, 0.1)',
			source: "ios",
		};
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.dismissAlert();

		expect(tapArgs()).toEqual([["--udid", "sim-1", "--x", "0.5", "--y", "0.75"]]);
		await session.quit();
	});

	test("alert matching is a case-insensitive substring on the label", async () => {
		describePayload = {
			description: 'AXButton "Allow While Using App"  (0.4, 0.5, 0.2, 0.1)',
			source: "ios",
		};
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.acceptAlert();

		expect(tapArgs()).toHaveLength(1);
		await session.quit();
	});

	test("no matching button throws an ActionNotFound-style error", async () => {
		describePayload = { description: 'AXStaticText "Hello"  (0.1, 0.1, 0.2, 0.1)', source: "ios" };
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await expect(session.acceptAlert()).rejects.toThrow(/No alert accept button/);
		await expect(session.dismissAlert()).rejects.toThrow(/No alert dismiss button/);
		await session.quit();
	});
});

describe("argent waitFor and pointer", () => {
	test("waitFor maps to await-ui-element with the selector JSON", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		const result = await session.waitFor("visible", { text: "Login" }, { timeoutMs: 2000 });

		expect(result).toMatchObject({ success: true });
		const calls = toolCalls.filter((call) => call.tool === "await-ui-element");
		expect(calls).toHaveLength(1);
		expect(calls[0]?.args).toEqual([
			"--udid",
			"sim-1",
			"--condition",
			"visible",
			"--selector-json",
			JSON.stringify({ text: "Login" }),
			"--timeoutMs",
			"2000",
		]);
		await session.quit();
	});

	test("waitFor rejects an unknown condition without tool calls", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });
		toolCalls = [];

		await expect(session.waitFor("bogus" as "visible", { text: "Login" })).rejects.toThrow(
			/condition/,
		);
		expect(toolCalls).toHaveLength(0);
		await session.quit();
	});

	test("pointer begin/move/end under 12 grid units taps", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.pointerEvent("begin", 500, 500, 1);
		expect(session.isPointerActive()).toBe(true);
		await session.pointerEvent("move", 503, 504, 2);
		await session.pointerEvent("end", 505, 505, 3);

		expect(session.isPointerActive()).toBe(false);
		const taps = toolCalls.filter((call) => call.tool === "gesture-tap");
		expect(taps).toHaveLength(1);
		expect(taps[0]?.args).toEqual(["--udid", "sim-1", "--x", "0.505", "--y", "0.505"]);
		await session.quit();
	});

	test("pointer end across the screen swipes from begin to end", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.pointerEvent("begin", 100, 100, 1);
		await session.pointerEvent("end", 500, 500, 2);

		const swipes = toolCalls.filter((call) => call.tool === "gesture-swipe");
		expect(swipes).toHaveLength(1);
		expect(swipes[0]?.args).toEqual([
			"--udid",
			"sim-1",
			"--fromX",
			"0.1",
			"--fromY",
			"0.1",
			"--toX",
			"0.5",
			"--toY",
			"0.5",
			"--durationMs",
			"300",
		]);
		await session.quit();
	});

	test("pointer end without begin throws", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await expect(session.pointerEvent("end", 500, 500, 1)).rejects.toThrow(/No active pointer/);
		await session.quit();
	});

	test("withActionLock holds exclusivity: actions inside reject as busy", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await expect(
			session.withActionLock(async () => {
				await session.tap(500, 500);
			}),
		).rejects.toThrow(/busy/);
		await session.quit();
	});

	test("withActionLock releases after the body so later actions run", async () => {
		const session = await createArgentDeviceSession({ platform: "ios", deviceId: "sim-1" });

		await session.withActionLock(async () => undefined);
		await session.tap(500, 500);

		expect(toolCalls.filter((call) => call.tool === "gesture-tap")).toHaveLength(1);
		await session.quit();
	});
});
