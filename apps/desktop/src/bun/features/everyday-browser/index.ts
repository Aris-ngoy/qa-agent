import { webDeviceOf } from "@yoqa/runner-client";
import type { OpenPathResult } from "../../../shared/cli-environment";
import { REMOTE_DEBUGGING_SETTING_URL } from "../../../shared/everyday-browser";

export type OpenSettingDeps = {
	platform?: NodeJS.Platform;
	/** Run a command; resolves to its exit code. */
	run?: (command: string[]) => Promise<number>;
};

async function spawnCommand(command: string[]): Promise<number> {
	const proc = Bun.spawn(command, { stdout: "ignore", stderr: "ignore", stdin: "ignore" });
	return proc.exited;
}

/**
 * `open -a` the Everyday browser `browserId` names, with `args` after it. `offMac` is the
 * reason given off macOS, where there is no `open`.
 */
async function openEverydayApp(
	browserId: string,
	args: string[],
	offMac: (app: string) => string,
	deps: OpenSettingDeps,
): Promise<OpenPathResult> {
	// The Everyday browser's app, as `open -a` names it.
	const device = webDeviceOf(browserId);
	const app = device?.kind === "everyday" ? device.browser.name : null;
	if (!app) return { ok: false, error: `${browserId} is not an Everyday browser` };
	if ((deps.platform ?? process.platform) !== "darwin") return { ok: false, error: offMac(app) };
	try {
		const code = await (deps.run ?? spawnCommand)(["open", "-a", app, ...args]);
		return code === 0
			? { ok: true }
			: { ok: false, error: `Could not open ${app} (open exited with code ${code})` };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * Open the remote-debugging setting in the Everyday browser `browserId` names, so the user
 * can turn it on. Only the user flips the toggle; Yoqa never writes the pref. `open -a`
 * opens a `chrome://` URL in a running browser and starts one that is not.
 */
export async function openRemoteDebuggingSetting(
	browserId: string,
	deps: OpenSettingDeps = {},
): Promise<OpenPathResult> {
	return openEverydayApp(
		browserId,
		[REMOTE_DEBUGGING_SETTING_URL],
		(app) => `Open ${REMOTE_DEBUGGING_SETTING_URL} in ${app} yourself: this works on macOS only`,
		deps,
	);
}

/**
 * Bring the Everyday browser `browserId` names to the front, so the user sees its Allow
 * prompt while a connect waits on it. `open -a` with no URL activates the running app and
 * leaves its tabs alone. Only a browser listed ready is brought forward, so this never
 * starts one (ADR-0009).
 */
export async function bringEverydayBrowserToFront(
	browserId: string,
	deps: OpenSettingDeps = {},
): Promise<OpenPathResult> {
	return openEverydayApp(
		browserId,
		[],
		(app) => `Switch to ${app} yourself to click Allow: this works on macOS only`,
		deps,
	);
}
