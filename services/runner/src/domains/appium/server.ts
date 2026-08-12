import { createServer } from "node:net";
import { resolveAppium } from "./application";
import type { ResolvedAppium } from "./models";

const DEFAULT_APPIUM_PORT = Number(process.env.YOQA_APPIUM_PORT ?? "4723");

export const APPIUM_HOST = process.env.YOQA_APPIUM_HOST ?? "127.0.0.1";

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
	// Prefer a free port over silently attaching to a foreign Appium
	// that rebuilds WDA without Yoqa signing / preinstalled caps.
	for (let offset = 1; offset <= 20; offset++) {
		const candidate = DEFAULT_APPIUM_PORT + offset;
		if (await isPortFree(candidate)) return candidate;
	}
	throw new Error(
		`No free Appium port near ${DEFAULT_APPIUM_PORT}. Quit other Appium processes or set YOQA_APPIUM_PORT.`,
	);
}

/** Ensure the Appium Server process is running; returns its listen port. */
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
