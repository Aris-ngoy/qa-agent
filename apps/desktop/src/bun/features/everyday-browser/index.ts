import type { OpenPathResult } from "../../../shared/cli-environment";

/** Where Chrome 144+, Edge and Dia keep the remote-debugging toggle (ADR-0009). */
export const REMOTE_DEBUGGING_SETTING_URL = "chrome://inspect/#remote-debugging";

/** Each Everyday browser's app, as `open -a` names it; the runner lists the same ids. */
const EVERYDAY_APPS: Record<string, string> = {
	"web-chrome-everyday": "Google Chrome",
	"web-edge-everyday": "Microsoft Edge",
	"web-brave-everyday": "Brave Browser",
	"web-chromium-everyday": "Chromium",
	"web-dia-everyday": "Dia",
};

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
 * Open the remote-debugging setting in the Everyday browser `browserId` names, so the user
 * can turn it on. Only the user flips the toggle; Yoqa never writes the pref. `open -a`
 * opens a `chrome://` URL in a running browser and starts one that is not.
 */
export async function openRemoteDebuggingSetting(
	browserId: string,
	deps: OpenSettingDeps = {},
): Promise<OpenPathResult> {
	const app = EVERYDAY_APPS[browserId];
	if (!app) return { ok: false, error: `${browserId} is not an Everyday browser` };
	if ((deps.platform ?? process.platform) !== "darwin") {
		return {
			ok: false,
			error: `Open ${REMOTE_DEBUGGING_SETTING_URL} in ${app} yourself: this works on macOS only`,
		};
	}
	try {
		const code = await (deps.run ?? spawnCommand)([
			"open",
			"-a",
			app,
			REMOTE_DEBUGGING_SETTING_URL,
		]);
		return code === 0
			? { ok: true }
			: { ok: false, error: `Could not open ${app} (open exited with code ${code})` };
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}
