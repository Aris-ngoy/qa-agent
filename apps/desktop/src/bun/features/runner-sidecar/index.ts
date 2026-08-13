import { homedir } from "node:os";
import { dirname, join } from "node:path";
import packageJson from "../../../../package.json" with { type: "json" };
import { androidToolchainProcessEnv } from "../android-toolchain";
import { RUNNER_CODE_IDENTIFIER, ensureAdhocCodeSignature } from "../macos-adhoc-sign";
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
const PORT_FREE_WAIT_MS = 400;

export type EnsureLocalServicesResult = {
	baseUrl: string;
	started: boolean;
};

export type RunnerHealthSnapshot = {
	ok: true;
	service: "yoqa-runner";
	version: string;
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
		join(home, ".opencode", "bin"),
		join(home, ".grok", "bin"),
		join(home, ".antigravity", "antigravity", "bin"),
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

/** Desktop app version expected from `/health` when we own the local runner. */
export function expectedRunnerVersion(): string {
	return process.env.YOQA_RUNNER_VERSION?.trim() || packageJson.version;
}

/** True when the URL points at this machine's loopback runner port. */
export function isLocalRunnerUrl(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		return url.hostname === "127.0.0.1" || url.hostname === "localhost";
	} catch {
		return false;
	}
}

/**
 * Accept only a healthy runner whose reported version matches the desktop build.
 * Otherwise upgrades keep serving a stale `yoqa-runner` already bound to :7420.
 */
export function isCompatibleRunnerHealth(
	health: RunnerHealthSnapshot | null,
	expectedVersion: string,
): boolean {
	return (
		health !== null &&
		health.ok === true &&
		health.service === "yoqa-runner" &&
		health.version === expectedVersion
	);
}

/** Candidate locations for the compiled runner inside a packaged Electrobun .app. */
export function packagedRunnerCandidates(roots: string[] = execRoots()): string[] {
	return packagedRunnerFileCandidates("yoqa-runner", roots);
}

async function findPackagedRunner(): Promise<string | null> {
	return findFirstExisting(packagedRunnerCandidates());
}

async function findRepoRoot(): Promise<string | null> {
	const starts: string[] = [];
	const fromEnv = process.env.YOQA_REPO_ROOT?.trim();
	if (fromEnv) starts.push(fromEnv);
	starts.push(process.cwd());
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

async function monorepoRunnerLaunch(repoRoot: string): Promise<RunnerLaunch> {
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

/**
 * Resolve how to launch the runner.
 * Prefer monorepo source when available so Electrobun `.app` embeds of an older
 * `yoqa-runner` do not shadow local PATH/auth fixes during `electrobun dev`.
 * Production `/Applications/yoqa.app` has no repo marker → packaged binary.
 * Force packaged with `YOQA_RUNNER_SOURCE=packaged`.
 */
export async function resolveRunnerLaunch(): Promise<RunnerLaunch> {
	const forcePackaged = process.env.YOQA_RUNNER_SOURCE?.trim() === "packaged";
	const repoRoot = forcePackaged ? null : await findRepoRoot();
	if (repoRoot) {
		return monorepoRunnerLaunch(repoRoot);
	}

	const packaged = await findPackagedRunner();
	if (packaged) {
		return { command: [packaged], source: "packaged" };
	}

	throw new Error(
		"Could not locate the Yoqa runner. Install the desktop app release, open the monorepo, or start it with `bun run runner`.",
	);
}

async function fetchRunnerHealth(baseUrl: string): Promise<RunnerHealthSnapshot | null> {
	try {
		const response = await fetch(`${baseUrl}/health`, {
			signal: AbortSignal.timeout(1500),
		});
		if (!response.ok) return null;
		const json = (await response.json()) as {
			ok?: boolean;
			service?: string;
			version?: string;
		};
		if (json.ok === true && json.service === "yoqa-runner" && typeof json.version === "string") {
			return { ok: true, service: "yoqa-runner", version: json.version };
		}
		return null;
	} catch {
		return null;
	}
}

async function waitForCompatibleRunner(
	baseUrl: string,
	expectedVersion: string,
	timeoutMs: number,
): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const health = await fetchRunnerHealth(baseUrl);
		if (isCompatibleRunnerHealth(health, expectedVersion)) return true;
		if (child && child.proc.exitCode !== null) {
			return false;
		}
		await Bun.sleep(HEALTH_POLL_MS);
	}
	return isCompatibleRunnerHealth(await fetchRunnerHealth(baseUrl), expectedVersion);
}

function isChildAlive(): boolean {
	return child !== null && child.proc.exitCode === null;
}

/** SIGTERM any process listening on the local runner port (macOS/Linux `lsof`). */
export async function killListenersOnPort(port: number): Promise<number[]> {
	const proc = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (exitCode !== 0 && !stdout.trim()) {
		return [];
	}

	const pids = [
		...new Set(
			stdout
				.split(/\s+/)
				.map((part) => part.trim())
				.filter(Boolean)
				.map((part) => Number(part))
				.filter((pid) => Number.isInteger(pid) && pid > 0),
		),
	];

	for (const pid of pids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	}

	if (pids.length > 0) {
		await Bun.sleep(PORT_FREE_WAIT_MS);
	}
	return pids;
}

async function spawnRunner(baseUrl: string): Promise<void> {
	if (isChildAlive()) return;

	const launch = await resolveRunnerLaunch();
	if (launch.source === "packaged") {
		const binary = launch.command[0];
		if (binary) {
			await ensureAdhocCodeSignature(binary, RUNNER_CODE_IDENTIFIER);
		}
	}
	console.log(`[yoqa desktop] starting runner sidecar → ${baseUrl}`);
	console.log(
		`[yoqa desktop] source=${launch.source} command=${launch.command.join(" ")}${
			launch.cwd ? ` cwd=${launch.cwd}` : ""
		}`,
	);

	const androidEnv = await androidToolchainProcessEnv();
	const proc = Bun.spawn(launch.command, {
		cwd: launch.cwd,
		env: {
			...process.env,
			...androidEnv,
			PATH: pathWithHostTools(),
			YOQA_RUNNER_HOST: getHost(),
			YOQA_RUNNER_PORT: String(getPort()),
			YOQA_RUNNER_VERSION: expectedRunnerVersion(),
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

async function replaceIncompatibleLocalRunner(
	baseUrl: string,
	health: RunnerHealthSnapshot,
	expectedVersion: string,
): Promise<void> {
	if (!isLocalRunnerUrl(baseUrl)) {
		throw new Error(
			`Runner at ${baseUrl} reports version ${health.version}, but this app expects ${expectedVersion}. Point YOQA_RUNNER_URL at a matching runner or unset it to use the bundled sidecar.`,
		);
	}

	console.warn(
		`[yoqa desktop] replacing stale runner ${health.version} with ${expectedVersion} on ${baseUrl}`,
	);
	stopRunnerSidecar();
	await killListenersOnPort(getPort());
}

async function ensureOnce(): Promise<EnsureLocalServicesResult> {
	const baseUrl = getBaseUrl();
	const expectedVersion = expectedRunnerVersion();
	const existing = await fetchRunnerHealth(baseUrl);

	if (isCompatibleRunnerHealth(existing, expectedVersion)) {
		return { baseUrl, started: false };
	}

	if (existing) {
		await replaceIncompatibleLocalRunner(baseUrl, existing, expectedVersion);
	}

	if (!isChildAlive()) {
		await spawnRunner(baseUrl);
	}

	const healthy = await waitForCompatibleRunner(baseUrl, expectedVersion, HEALTH_TIMEOUT_MS);
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

/** Stop the local runner (sidecar child and any listeners on the runner port). */
export async function stopLocalRunner(): Promise<{ ok: true }> {
	stopRunnerSidecar();
	await killListenersOnPort(getPort());
	return { ok: true };
}

/** Stop then ensure a compatible local runner is listening again. */
export async function restartLocalRunner(): Promise<EnsureLocalServicesResult> {
	await stopLocalRunner();
	await Bun.sleep(PORT_FREE_WAIT_MS);
	return ensureLocalServices();
}
