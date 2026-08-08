import { resolveBinary, runCommand } from "./drivers/probe";

const OPENCODE_SERVER_READY_PREFIX = "opencode server listening";
const DEFAULT_HOSTNAME = "127.0.0.1";
const STARTUP_TIMEOUT_MS = 30_000;

type ManagedOpenCodeServer = {
	url: string;
	proc: ReturnType<typeof Bun.spawn>;
};

let managed: ManagedOpenCodeServer | null = null;

export function parseOpenCodeServerUrlFromOutput(output: string): string | null {
	for (const line of output.split("\n")) {
		if (!line.includes(OPENCODE_SERVER_READY_PREFIX)) continue;
		const match = line.match(/on\s+(https?:\/\/[^\s]+)/);
		if (match?.[1]) return match[1].replace(/\/$/, "");
	}
	return null;
}

function isManagedAlive(): boolean {
	return managed !== null && managed.proc.exitCode === null;
}

/** Stop a Yoqa-spawned OpenCode serve (no-op for external Server URL). */
export function stopManagedOpenCodeServer(): void {
	if (!managed) return;
	const current = managed;
	managed = null;
	try {
		current.proc.kill();
	} catch {
		// already exited
	}
}

async function readStreamText(
	stream: ReadableStream<Uint8Array> | null,
	onUpdate: (chunk: string) => void,
): Promise<void> {
	if (!stream) return;
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) onUpdate(decoder.decode(value, { stream: true }));
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			// ignore
		}
	}
}

/**
 * Like t3code `connectToOpenCodeServer`: use configured Server URL, or spawn
 * `opencode serve` on an ephemeral port and wait for the ready line.
 */
export async function ensureOpenCodeServer(input: {
	binaryPath?: string | null;
	serverUrl?: string | null;
}): Promise<{ url: string; external: boolean }> {
	const configured = input.serverUrl?.trim();
	if (configured) {
		return { url: configured.replace(/\/$/, ""), external: true };
	}

	if (isManagedAlive() && managed) {
		return { url: managed.url, external: false };
	}
	stopManagedOpenCodeServer();

	const resolved = await resolveBinary("opencode", input.binaryPath);
	if (!resolved.path) {
		throw new Error(
			resolved.detail ||
				"`opencode` is not installed or not on PATH. Install OpenCode or set Server URL.",
		);
	}

	const proc = Bun.spawn([resolved.path, "serve", `--hostname=${DEFAULT_HOSTNAME}`, "--port=0"], {
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			OPENCODE_CONFIG_CONTENT: "{}",
		},
	});

	let stdout = "";
	let stderr = "";

	const url = await new Promise<string>((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
		};

		const timer = setTimeout(() => {
			finish(() => {
				try {
					proc.kill();
				} catch {
					// ignore
				}
				reject(
					new Error(`Timed out waiting for OpenCode server start after ${STARTUP_TIMEOUT_MS}ms.`),
				);
			});
		}, STARTUP_TIMEOUT_MS);

		const consider = () => {
			const parsed = parseOpenCodeServerUrlFromOutput(`${stdout}\n${stderr}`);
			if (parsed) {
				finish(() => resolve(parsed));
			}
		};

		void readStreamText(proc.stdout, (chunk) => {
			stdout += chunk;
			consider();
		});
		void readStreamText(proc.stderr, (chunk) => {
			stderr += chunk;
			consider();
		});

		void proc.exited.then((code) => {
			finish(() => {
				const detail = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
				reject(
					new Error(
						detail
							? `OpenCode server exited before ready (code ${code}).\n${detail.slice(0, 400)}`
							: `OpenCode server exited before ready (code ${code}).`,
					),
				);
			});
		});
	});

	managed = { url, proc };
	void proc.exited.then(() => {
		if (managed?.proc === proc) managed = null;
	});
	return { url, external: false };
}

/** Quick CLI presence check used by vision auth (no serve spawn). */
export async function openCodeCliAvailable(binaryPath?: string | null): Promise<boolean> {
	const resolved = await resolveBinary("opencode", binaryPath);
	if (!resolved.path) return false;
	const version = await runCommand([resolved.path, "--version"], { timeoutMs: 8_000 });
	return version.exitCode === 0;
}
