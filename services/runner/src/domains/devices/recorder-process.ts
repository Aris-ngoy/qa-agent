import type { Subprocess } from "bun";

/** A recorder that exits within this window failed to start (no display, bad device, ...). */
const EARLY_EXIT_PROBE_MS = 1000;

/**
 * Spawn a long-lived screen recorder and make sure it is still running a moment later, so a
 * recorder that dies at startup is reported instead of returned as a dead handle.
 */
export async function spawnRecorder(
	cmd: string[],
	label: string,
	stdout: "ignore" | "pipe" = "ignore",
): Promise<Subprocess<"ignore", "ignore" | "pipe", "pipe">> {
	const proc = Bun.spawn(cmd, { stdout, stderr: "pipe" });
	const early = await Promise.race([proc.exited, Bun.sleep(EARLY_EXIT_PROBE_MS).then(() => null)]);
	if (early !== null) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`${label}: ${stderr.trim() || `exit ${early}`}`);
	}
	return proc as Subprocess<"ignore", "ignore" | "pipe", "pipe">;
}

/** Resolves true when `proc` exits within `ms`, false on timeout. */
export async function exitsWithin(proc: Subprocess, ms: number): Promise<boolean> {
	const result = await Promise.race([
		proc.exited.then(() => true),
		Bun.sleep(ms).then(() => false),
	]);
	return result;
}
