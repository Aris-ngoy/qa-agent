import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Capability, DevicePlatform } from "@yoqa/runner-client";
import { type Browser, remote } from "webdriverio";
import { resolveAppium } from "../appium/application";
import type { ResolvedAppium } from "../appium/models";
import { loadDevicePrep } from "../ios/application";

const YOQA_ROOT = join(homedir(), ".yoqa");
const DEFAULT_APPIUM_PORT = Number(process.env.YOQA_APPIUM_PORT ?? "4723");
const APPIUM_HOST = process.env.YOQA_APPIUM_HOST ?? "127.0.0.1";
const SCREENSHOT_DIR = join(YOQA_ROOT, "runs", "screenshots");

type AppiumProcess = {
	proc: ReturnType<typeof Bun.spawn>;
	appium: ResolvedAppium;
	port: number;
};

let appiumProcess: AppiumProcess | null = null;

async function waitForAppium(port: number, timeoutMs = 30_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(`http://${APPIUM_HOST}:${port}/status`);
			if (response.ok) return;
		} catch {
			// not ready yet
		}
		await Bun.sleep(400);
	}
	throw new Error(`Appium did not become ready on ${APPIUM_HOST}:${port}`);
}

function appiumCommand(appium: ResolvedAppium, port: number): string[] {
	const args = ["--address", APPIUM_HOST, "--port", String(port), "--relaxed-security"];
	if (appium.invokeViaNode) {
		return [appium.nodeBin ?? "node", appium.bin, ...args];
	}
	return [appium.bin, ...args];
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.listen(port, APPIUM_HOST, () => {
			server.close(() => resolve(true));
		});
	});
}

async function pickAppiumPort(): Promise<number> {
	if (await isPortFree(DEFAULT_APPIUM_PORT)) return DEFAULT_APPIUM_PORT;
	// Prefer a free port over silently attaching to a foreign Appium (e.g. noqa.app)
	// that rebuilds WDA without YoQA signing / preinstalled caps.
	for (let offset = 1; offset <= 20; offset++) {
		const candidate = DEFAULT_APPIUM_PORT + offset;
		if (await isPortFree(candidate)) return candidate;
	}
	throw new Error(
		`No free Appium port near ${DEFAULT_APPIUM_PORT}. Quit other Appium processes (e.g. noqa) or set YOQA_APPIUM_PORT.`,
	);
}

export async function ensureAppiumServer(): Promise<number> {
	if (appiumProcess) {
		await waitForAppium(appiumProcess.port);
		return appiumProcess.port;
	}

	const appium = await resolveAppium();
	const port = await pickAppiumPort();
	const command = appiumCommand(appium, port);
	const proc = Bun.spawn(command, {
		cwd: appium.cwd,
		env: { ...process.env, ...appium.env },
		stdout: "ignore",
		stderr: "ignore",
	});
	appiumProcess = { proc, appium, port };
	await waitForAppium(port);
	return port;
}

function capabilitiesToRecord(caps: Capability[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const cap of caps) {
		const key = cap.key.trim();
		if (!key) continue;
		out[key] = cap.value;
	}
	return out;
}

export function mergeCapabilities(
	appCaps: Capability[],
	caseCaps: Capability[],
): Record<string, string> {
	return {
		...capabilitiesToRecord(appCaps),
		...capabilitiesToRecord(caseCaps),
	};
}

export type SessionOptions = {
	platform: DevicePlatform;
	deviceId: string;
	appCaps: Capability[];
	caseCaps: Capability[];
	bundleId?: string;
	appPackage?: string;
};

export type DeviceSession = {
	browser: Browser;
	quit: () => Promise<void>;
	screenshot: () => Promise<{ path: string; base64: string }>;
	pageSource: () => Promise<string>;
	getWindowSize: () => Promise<{ width: number; height: number }>;
	tap: (xNorm: number, yNorm: number) => Promise<void>;
	swipe: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	drag: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	type: (text: string) => Promise<void>;
	activateApp: (appId: string) => Promise<void>;
	terminateApp: (appId: string) => Promise<void>;
	backgroundApp: (seconds?: number) => Promise<void>;
	openUrl: (url: string) => Promise<void>;
	acceptAlert: () => Promise<void>;
	dismissAlert: () => Promise<void>;
};

/** Apple physical UDIDs look like `00008120-000E6D813E2A601E` (not a standard UUID). */
function looksLikePhysicalIosUdid(udid: string): boolean {
	return /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{16}$/.test(udid.trim());
}

async function buildW3cCapabilities(options: SessionOptions): Promise<Record<string, unknown>> {
	const merged = mergeCapabilities(options.appCaps, options.caseCaps);
	const platformName = options.platform === "ios" ? "iOS" : "Android";
	const automationName = options.platform === "ios" ? "XCUITest" : "UiAutomator2";

	const caps: Record<string, unknown> = {
		platformName,
		"appium:automationName": automationName,
		"appium:udid": options.deviceId,
		"appium:newCommandTimeout": 120,
		...Object.fromEntries(
			Object.entries(merged).map(([key, value]) =>
				key.includes(":") ? [key, value] : [`appium:${key}`, value],
			),
		),
	};

	if (options.platform === "ios" && options.bundleId && !caps["appium:bundleId"]) {
		caps["appium:bundleId"] = options.bundleId;
	}
	if (options.platform === "android" && options.appPackage && !caps["appium:appPackage"]) {
		caps["appium:appPackage"] = options.appPackage;
	}

	if (options.platform === "ios" && looksLikePhysicalIosUdid(options.deviceId)) {
		const prep = await loadDevicePrep(options.deviceId);
		if (!prep) {
			throw new Error(
				`iOS device ${options.deviceId} is not prepared. Run device setup so WebDriverAgent is installed before starting a run.`,
			);
		}
		// Reuse the YoQA-built/signed WDA instead of Appium's unsigned xcodebuild (code 65).
		if (caps["appium:usePreinstalledWDA"] === undefined) {
			caps["appium:usePreinstalledWDA"] = true;
		}
		if (!caps["appium:updatedWDABundleId"]) {
			caps["appium:updatedWDABundleId"] = prep.bundleId;
		}
		if (!caps["appium:xcodeOrgId"]) {
			caps["appium:xcodeOrgId"] = prep.developmentTeam;
		}
		if (!caps["appium:xcodeSigningId"]) {
			caps["appium:xcodeSigningId"] = "Apple Development";
		}
	}

	return caps;
}

export async function createDeviceSession(options: SessionOptions): Promise<DeviceSession> {
	const port = await ensureAppiumServer();
	const capabilities = await buildW3cCapabilities(options);

	const browser = await remote({
		hostname: APPIUM_HOST,
		port,
		path: "/",
		capabilities,
		logLevel: "error",
		connectionRetryCount: 2,
		connectionRetryTimeout: 60_000,
	});

	const quit = async () => {
		try {
			await browser.deleteSession();
		} catch {
			// session may already be gone
		}
	};

	const getWindowSize = async () => browser.getWindowSize();

	const toPx = (norm: number, size: number) =>
		Math.round((Math.min(1000, Math.max(0, norm)) / 1000) * size);

	const screenshot = async () => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const base64 = await browser.takeScreenshot();
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		await Bun.write(path, Uint8Array.from(Buffer.from(base64, "base64")));
		return { path, base64 };
	};

	const pageSource = async () => browser.getPageSource();

	const tap = async (xNorm: number, yNorm: number) => {
		const size = await getWindowSize();
		const x = toPx(xNorm, size.width);
		const y = toPx(yNorm, size.height);
		await browser.performActions([
			{
				type: "pointer",
				id: "finger1",
				parameters: { pointerType: "touch" },
				actions: [
					{ type: "pointerMove", duration: 0, x, y },
					{ type: "pointerDown", button: 0 },
					{ type: "pause", duration: 50 },
					{ type: "pointerUp", button: 0 },
				],
			},
		]);
		await browser.releaseActions();
	};

	const swipe = async (x1: number, y1: number, x2: number, y2: number, durationMs = 400) => {
		const size = await getWindowSize();
		await browser.performActions([
			{
				type: "pointer",
				id: "finger1",
				parameters: { pointerType: "touch" },
				actions: [
					{ type: "pointerMove", duration: 0, x: toPx(x1, size.width), y: toPx(y1, size.height) },
					{ type: "pointerDown", button: 0 },
					{
						type: "pointerMove",
						duration: durationMs,
						x: toPx(x2, size.width),
						y: toPx(y2, size.height),
					},
					{ type: "pointerUp", button: 0 },
				],
			},
		]);
		await browser.releaseActions();
	};

	const drag = async (x1: number, y1: number, x2: number, y2: number, durationMs = 800) => {
		await swipe(x1, y1, x2, y2, durationMs);
	};

	const type = async (text: string) => {
		await browser.keys(text.split(""));
	};

	const activateApp = async (appId: string) => {
		await browser.execute("mobile: activateApp", { bundleId: appId, appId });
	};

	const terminateApp = async (appId: string) => {
		await browser.execute("mobile: terminateApp", { bundleId: appId, appId });
	};

	const backgroundApp = async (seconds = 3) => {
		await browser.execute("mobile: backgroundApp", { seconds });
	};

	const openUrl = async (url: string) => {
		await browser.url(url);
	};

	const acceptAlert = async () => {
		await browser.acceptAlert();
	};

	const dismissAlert = async () => {
		await browser.dismissAlert();
	};

	return {
		browser,
		quit,
		screenshot,
		pageSource,
		getWindowSize,
		tap,
		swipe,
		drag,
		type,
		activateApp,
		terminateApp,
		backgroundApp,
		openUrl,
		acceptAlert,
		dismissAlert,
	};
}
