import { homedir } from "node:os";
import { dirname, join } from "node:path";
import packageJson from "../../../../package.json" with { type: "json" };
import {
	execRoots,
	findFirstExisting,
	packagedRunnerFileCandidates,
	pathExists,
} from "../packaged-resources";

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

type RunnerLaunch = {
	command: string[];
	cwd?: string;
	source: "packaged" | "monorepo";
};

let child: RunnerChild | null = null;
let ensureInFlight: Promise<EnsureLocalServicesResult> | null = null;

/** Finder/Dock omit Homebrew from PATH — mirror runner host-path.ts. */
function pathWithHostTools(): string {
	const home = homedir();
	const extras = [
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		join(home, ".local", "bin"),
		join(home, ".bun", "bin"),
	];
	const existing = (process.env.PATH ?? "").split(":").filter(Boolean);
	const prepend = extras.filter((dir) => !existing.includes(dir));
	return [...prepend, ...existing].join(":");
}

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

/** Candidate locations for the compiled runner inside a packaged Electrobun .app. */
export function packagedRunnerCandidates(roots: string[] = execRoots()): string[] {
	return packagedRunnerFileCandidates("yoqa-runner", roots);
}

async function findPackagedRunner(): Promise<string | null> {
	return findFirstExisting(packagedRunnerCandidates());
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
	for (const root of execRoots()) {
		const beside = join(root, "bun");
		if (await pathExists(beside)) return beside;
	}

	const fromPath = Bun.which("bun");
	if (fromPath) return fromPath;

	const cwdBun = join(process.cwd(), "bun");
	if (await pathExists(cwdBun)) return cwdBun;

	throw new Error("Could not find a bun executable to start the local runner.");
}

/** Resolve how to launch the runner: packaged binary first, monorepo source for dev. */
export async function resolveRunnerLaunch(): Promise<RunnerLaunch> {
	const packaged = await findPackagedRunner();
	if (packaged) {
		return { command: [packaged], source: "packaged" };
	}

	const repoRoot = await findRepoRoot();
	if (!repoRoot) {
		throw new Error(
			"Could not locate the YoQA runner. Install the desktop app release, open the monorepo, or start it with `bun run runner`.",
		);
	}

	const entry = join(repoRoot, "services", "runner", "src", "index.ts");
	if (!(await pathExists(entry))) {
		throw new Error(`Runner entry not found at ${entry}`);
	}

	const bunBin = await resolveBunExecutable();
	return {
		command: [bunBin, "run", entry],
		cwd: join(repoRoot, "services", "runner"),
		source: "monorepo",
	};
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

	const launch = await resolveRunnerLaunch();
	console.log(`[yoqa desktop] starting runner sidecar → ${baseUrl}`);
	console.log(
		`[yoqa desktop] source=${launch.source} command=${launch.command.join(" ")}${
			launch.cwd ? ` cwd=${launch.cwd}` : ""
		}`,
	);

	const proc = Bun.spawn(launch.command, {
		cwd: launch.cwd,
		env: {
			...process.env,
			PATH: pathWithHostTools(),
			YOQA_RUNNER_HOST: getHost(),
			YOQA_RUNNER_PORT: String(getPort()),
			YOQA_RUNNER_VERSION: process.env.YOQA_RUNNER_VERSION ?? packageJson.version,
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
