import { dirname, join } from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7420;
const HEALTH_POLL_MS = 400;
const HEALTH_TIMEOUT_MS = 20_000;

export type EnsureLocalServicesResult = {
	baseUrl: string;
	started: boolean;
};

type RunnerChild = {
	proc: ReturnType<typeof Bun.spawn>;
	baseUrl: string;
};

let child: RunnerChild | null = null;
let ensureInFlight: Promise<EnsureLocalServicesResult> | null = null;

function getBaseUrl(): string {
	return (process.env.YOQA_RUNNER_URL ?? `http://${DEFAULT_HOST}:${DEFAULT_PORT}`).replace(
		/\/$/,
		"",
	);
}

function getPort(): number {
	const fromEnv = Number(process.env.YOQA_RUNNER_PORT ?? String(DEFAULT_PORT));
	return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PORT;
}

function getHost(): string {
	return process.env.YOQA_RUNNER_HOST ?? DEFAULT_HOST;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

async function findRepoRoot(): Promise<string | null> {
	const starts = [process.cwd()];
	if (typeof import.meta.dir === "string") {
		starts.push(import.meta.dir);
	}

	for (const start of starts) {
		let dir = start;
		for (let i = 0; i < 14; i++) {
			const marker = join(dir, "services", "runner", "src", "index.ts");
			if (await pathExists(marker)) {
				return dir;
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}

	return null;
}

async function resolveBunExecutable(): Promise<string> {
	const fromPath = Bun.which("bun");
	if (fromPath) return fromPath;

	const bundled = join(process.cwd(), "bun");
	if (await pathExists(bundled)) return bundled;

	throw new Error("Could not find a bun executable to start the local runner.");
}

async function isHealthy(baseUrl: string): Promise<boolean> {
	try {
		const response = await fetch(`${baseUrl}/health`, {
			signal: AbortSignal.timeout(1500),
		});
		if (!response.ok) return false;
		const json = (await response.json()) as { ok?: boolean; service?: string };
		return json.ok === true && json.service === "yoqa-runner";
	} catch {
		return false;
	}
}

async function waitForHealthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await isHealthy(baseUrl)) return true;
		if (child && child.proc.exitCode !== null) {
			return false;
		}
		await Bun.sleep(HEALTH_POLL_MS);
	}
	return await isHealthy(baseUrl);
}

function isChildAlive(): boolean {
	return child !== null && child.proc.exitCode === null;
}

async function spawnRunner(baseUrl: string): Promise<void> {
	if (isChildAlive()) return;

	const repoRoot = await findRepoRoot();
	if (!repoRoot) {
		throw new Error(
			"Could not locate the YoQA runner in this checkout. Open the monorepo, or start it with `bun run runner`.",
		);
	}

	const entry = join(repoRoot, "services", "runner", "src", "index.ts");
	const runnerCwd = join(repoRoot, "services", "runner");
	const bunBin = await resolveBunExecutable();

	if (!(await pathExists(entry))) {
		throw new Error(`Runner entry not found at ${entry}`);
	}

	console.log(`[yoqa desktop] starting runner sidecar → ${baseUrl}`);
	console.log(`[yoqa desktop] bun=${bunBin} entry=${entry}`);

	const proc = Bun.spawn([bunBin, "run", entry], {
		cwd: runnerCwd,
		env: {
			...process.env,
			YOQA_RUNNER_HOST: getHost(),
			YOQA_RUNNER_PORT: String(getPort()),
		},
		stdout: "inherit",
		stderr: "inherit",
		stdin: "ignore",
	});

	child = { proc, baseUrl };

	void proc.exited.then((code) => {
		console.log(`[yoqa desktop] runner sidecar exited (code=${code})`);
		if (child?.proc === proc) {
			child = null;
		}
	});
}

async function ensureOnce(): Promise<EnsureLocalServicesResult> {
	const baseUrl = getBaseUrl();

	if (await isHealthy(baseUrl)) {
		return { baseUrl, started: false };
	}

	if (!isChildAlive()) {
		await spawnRunner(baseUrl);
	}

	const healthy = await waitForHealthy(baseUrl, HEALTH_TIMEOUT_MS);
	if (!healthy) {
		const exitHint =
			child?.proc.exitCode !== null && child?.proc.exitCode !== undefined
				? ` Process exited with code ${child.proc.exitCode}.`
				: "";
		stopRunnerSidecar();
		throw new Error(
			`Local runner failed to start.${exitHint} Retry, or run \`bun run runner\` manually.`,
		);
	}

	return { baseUrl, started: true };
}

/** Start the local runner if it is not already healthy. Idempotent. */
export function ensureLocalServices(): Promise<EnsureLocalServicesResult> {
	if (!ensureInFlight) {
		ensureInFlight = ensureOnce().finally(() => {
			ensureInFlight = null;
		});
	}
	return ensureInFlight;
}

/** Kill the sidecar only if this process started it. */
export function stopRunnerSidecar(): void {
	if (!child) return;
	const proc = child.proc;
	child = null;
	try {
		proc.kill();
		console.log("[yoqa desktop] stopped runner sidecar");
	} catch (error) {
		console.warn("[yoqa desktop] failed to stop runner sidecar", error);
	}
}
