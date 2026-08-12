/**
 * Bun `build --compile` on macOS emits a linker-signed Mach-O, then appends the
 * bytecode blob and invalidates that signature. Apple Silicon AMFI SIGKILLs the
 * result (exit 137) before main() — even for `--version`.
 *
 * Adhoc re-sign after compile (and as a launch-time repair) is enough for local
 * / unsigned Electrobun builds. Do not pass `--options runtime`: Bun's compiler
 * needs JIT, and hardened runtime without entitlements also gets killed.
 */

export type AdhocSignResult = "skipped" | "valid" | "resigned";

export const CLI_CODE_IDENTIFIER = "ai.yoqa.cli";
export const RUNNER_CODE_IDENTIFIER = "ai.yoqa.runner";

export async function verifyMacCodeSignature(filePath: string): Promise<boolean> {
	const proc = Bun.spawn(["codesign", "--verify", filePath], {
		stdout: "ignore",
		stderr: "pipe",
		stdin: "ignore",
	});
	return (await proc.exited) === 0;
}

export async function ensureAdhocCodeSignature(
	filePath: string,
	identifier: string,
	platform = process.platform,
): Promise<AdhocSignResult> {
	if (platform !== "darwin") return "skipped";
	if (!(await Bun.file(filePath).exists())) {
		throw new Error(`Cannot codesign missing file: ${filePath}`);
	}
	if (await verifyMacCodeSignature(filePath)) return "valid";

	const proc = Bun.spawn(
		["codesign", "--force", "--sign", "-", "--identifier", identifier, filePath],
		{
			stdout: "ignore",
			stderr: "pipe",
			stdin: "ignore",
		},
	);
	const code = await proc.exited;
	if (code !== 0) {
		const err = await new Response(proc.stderr).text();
		throw new Error(`codesign failed for ${filePath}: ${err.trim() || `exit ${code}`}`);
	}
	if (!(await verifyMacCodeSignature(filePath))) {
		throw new Error(`Adhoc codesign left an invalid signature: ${filePath}`);
	}
	return "resigned";
}
