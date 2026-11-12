/**
 * Running a Direct lane's device tool (`adb`, `idb`, `xcrun devicectl`): one spawn that
 * collects stdout (as text and bytes), stderr and the exit code, and the one way a failed
 * run becomes an error. Every Lane that shells out uses these, so a tool's failure reads
 * the same on every platform.
 */

export type ToolResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
	stdoutBytes?: Uint8Array;
};

export type ToolExec<R extends ToolResult = ToolResult> = (args: string[]) => Promise<R>;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A failed run as an error: `label`, then what the tool said, else its exit code. */
export function toolFailure(result: ToolResult, label: string): Error {
	return new Error(
		`${label}: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`,
	);
}

/** `result` when the tool exited 0; otherwise its failure, thrown. */
export function requireOk<R extends ToolResult>(result: R, label: string): R {
	if (result.exitCode !== 0) throw toolFailure(result, label);
	return result;
}

/**
 * Run `command` to the end. A tool that cannot be spawned at all exits 127 with the spawn
 * error as its stderr, as a shell would, so a Lane's tool-loss check sees it.
 */
export async function spawnTool(command: string[]): Promise<ToolResult> {
	try {
		const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
		const [stdoutBuf, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).arrayBuffer(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		const stdoutBytes = new Uint8Array(stdoutBuf);
		return { stdout: new TextDecoder().decode(stdoutBytes), stderr, exitCode, stdoutBytes };
	} catch (error) {
		return { stdout: "", stderr: errorMessage(error), exitCode: 127 };
	}
}
