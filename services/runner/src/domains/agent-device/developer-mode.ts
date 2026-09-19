import { ensureHostToolPath } from "./host-path";

/**
 * macOS Developer Mode gate for the physical-iOS runner.
 *
 * agent-device runs `DevToolsSecurity -status` before starting its XCTest
 * runner on a physical device and fails with "Developer mode is disabled for
 * Apple development tools" when it is off. Simulators are unaffected.
 * Enabling requires an admin password, so the runner never flips it silently —
 * `yoqa doctor --fix` (repair `enable-developer-tools`) escalates with an
 * explicit password prompt instead.
 */

/** agent-device's exact macOS gate message. */
export const DEVELOPER_MODE_DISABLED_MESSAGE =
	"Developer mode is disabled for Apple development tools";

/** Upstream fix command (requires admin password). */
export const DEVELOPER_MODE_FIX_COMMAND = "sudo DevToolsSecurity -enable";

/** Normalized error code for the gate (upstream reports COMMAND_FAILED). */
export const DEVELOPER_MODE_DISABLED_CODE = "DEVELOPER_MODE_DISABLED";

/** True when text matches the macOS Developer Mode gate (message or status output). */
export function isDeveloperModeDisabledText(text: string): boolean {
	return /developer mode is (currently )?disabled/i.test(text);
}

/** Repair path appended to the gate error hint. */
export function developerModeRepairHint(): string {
	return "Or run `yoqa doctor --fix` (repair `enable-developer-tools`) — it prompts for your password.";
}

/** Pure classifier over `DevToolsSecurity -status` output (unit-testable). */
export function classifyDeveloperModeStatus(output: string): "pass" | "warn" {
	return isDeveloperModeDisabledText(output) ? "warn" : "pass";
}

async function runCommand(
	command: string[],
	options: { timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	ensureHostToolPath();
	const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
	const timeoutMs = options.timeoutMs ?? 15_000;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		try {
			proc.kill();
		} catch {
			// ignore
		}
	}, timeoutMs);
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		if (timedOut) throw new Error(`timed out after ${timeoutMs}ms: ${command.join(" ")}`);
		return { stdout, stderr, exitCode };
	} finally {
		clearTimeout(timer);
	}
}

/** Read-only probe of macOS Developer Mode (never escalates). */
export async function probeDeveloperMode(): Promise<{ status: "pass" | "warn"; detail: string }> {
	if (process.platform !== "darwin") {
		return { status: "pass", detail: "Developer Mode only applies on macOS" };
	}
	try {
		const { stdout, stderr } = await runCommand(["DevToolsSecurity", "-status"]);
		const output = `${stdout}\n${stderr}`.trim();
		if (!output) return { status: "pass", detail: "DevToolsSecurity unavailable" };
		const status = classifyDeveloperModeStatus(output);
		return {
			status,
			detail:
				status === "warn"
					? "Developer Mode is disabled — physical-iOS runner will fail (simulators unaffected)"
					: output.split("\n")[0]?.trim() || "Developer Mode enabled",
		};
	} catch {
		return { status: "pass", detail: "DevToolsSecurity unavailable" };
	}
}

async function sudoHasCachedCredentials(): Promise<boolean> {
	try {
		const { exitCode } = await runCommand(["sudo", "-n", "true"], { timeoutMs: 10_000 });
		return exitCode === 0;
	} catch {
		return false;
	}
}

/**
 * Enable macOS Developer Mode for Apple development tools.
 *
 * Always escalates through an explicit password prompt — never silently:
 * - cached sudo credentials → runs directly (no prompt needed);
 * - interactive terminal → `sudo` prompts for the password on stdin;
 * - otherwise (desktop GUI, CI) → native macOS password dialog via osascript.
 */
export async function enableDeveloperMode(): Promise<string> {
	if (process.platform !== "darwin") {
		throw new Error("Developer Mode only applies on macOS");
	}
	ensureHostToolPath();

	if (await sudoHasCachedCredentials()) {
		const { stderr, exitCode } = await runCommand(["sudo", "-n", "DevToolsSecurity", "-enable"], {
			timeoutMs: 60_000,
		});
		if (exitCode !== 0) {
			throw new Error(`DevToolsSecurity -enable failed: ${stderr.trim().slice(0, 300)}`);
		}
	} else if (process.stdin.isTTY) {
		const proc = Bun.spawn(["sudo", "DevToolsSecurity", "-enable"], {
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			throw new Error(
				`DevToolsSecurity -enable failed (exit ${exitCode}). Run \`${DEVELOPER_MODE_FIX_COMMAND}\` manually, or enable Developer Mode in System Settings → Privacy & Security (requires reboot).`,
			);
		}
	} else {
		try {
			const { stderr, exitCode } = await runCommand(
				[
					"osascript",
					"-e",
					'do shell script "DevToolsSecurity -enable" with administrator privileges',
				],
				{ timeoutMs: 180_000 },
			);
			if (exitCode !== 0) {
				throw new Error(stderr.trim().slice(0, 300) || `exit ${exitCode}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Could not prompt for your password (${message}). Run \`${DEVELOPER_MODE_FIX_COMMAND}\` in a terminal, or enable Developer Mode in System Settings → Privacy & Security (requires reboot).`,
			);
		}
	}

	const verify = await probeDeveloperMode();
	if (verify.status !== "pass") {
		throw new Error(
			"Developer Mode is still disabled after enabling. Enable it in System Settings → Privacy & Security (requires reboot), then retry.",
		);
	}
	return "Enabled Developer Mode for Apple development tools";
}
