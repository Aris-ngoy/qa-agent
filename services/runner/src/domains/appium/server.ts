import { createServer } from "node:net";
import { ensureAndroidSdkEnv } from "./android-sdk";
import { resolveAppium } from "./application";
import type { ResolvedAppium } from "./models";

const DEFAULT_APPIUM_PORT = Number(process.env.YOQA_APPIUM_PORT ?? "4723");
const APPIUM_PORT_SCAN_COUNT = 21; // 4723–4743 inclusive

export const APPIUM_HOST = process.env.YOQA_APPIUM_HOST ?? "127.0.0.1";

export type ManagedAppiumInfo = {
	id: string;
	kind: "appium";
	ownership: "managed";
	pid: number;
	port: number;
	startedAt: number;
	status: "running";
};

export type ForeignAppiumInfo = {
	id: string;
	kind: "appium";
	ownership: "foreign";
	pid: number;
	port: number;
	status: "running";
};

type AppiumProcess = {
	proc: ReturnType<typeof Bun.spawn>;
	appium: ResolvedAppium;
	port: number;
	startedAt: number;
	id: string;
};

let appiumProcess: AppiumProcess | null = null;
let onAppiumStopped: (() => void) | null = null;

/** Register a callback when the managed Appium process exits or is stopped. */
export function setOnAppiumStopped(handler: (() => void) | null): void {
	onAppiumStopped = handler;
}

function notifyAppiumStopped(): void {
	try {
		onAppiumStopped?.();
	} catch {
		// Listeners must not break stop/restart.
	}
}

async function waitForAppium(port: number, timeoutMs = 30_000): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const response = await fetch(`http://${APPIUM_HOST}:${port}/status`);
			if (response.ok) return;
		} catch {
			// not ready yet
		}
		await Bun.sleep(400);
	}
	throw new Error(`Appium did not become ready on ${APPIUM_HOST}:${port}`);
}

async function isAppiumStatusOk(port: number): Promise<boolean> {
	try {
		const response = await fetch(`http://${APPIUM_HOST}:${port}/status`);
		return response.ok;
	} catch {
		return false;
	}
}

function appiumCommand(appium: ResolvedAppium, port: number): string[] {
	const args = ["--address", APPIUM_HOST, "--port", String(port), "--relaxed-security"];
	if (appium.invokeViaNode) {
		return [appium.nodeBin ?? "node", appium.bin, ...args];
	}
	return [appium.bin, ...args];
}

function isPortFree(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server = createServer();
		server.unref();
		server.once("error", () => resolve(false));
		server.listen(port, APPIUM_HOST, () => {
			server.close(() => resolve(true));
		});
	});
}

async function pickAppiumPort(): Promise<number> {
	if (await isPortFree(DEFAULT_APPIUM_PORT)) return DEFAULT_APPIUM_PORT;
	// Prefer a free port over silently attaching to a foreign Appium
	// that rebuilds WDA without Yoqa signing / preinstalled caps.
	for (let offset = 1; offset <= 20; offset++) {
		const candidate = DEFAULT_APPIUM_PORT + offset;
		if (await isPortFree(candidate)) return candidate;
	}
	throw new Error(
		`No free Appium port near ${DEFAULT_APPIUM_PORT}. Quit other Appium processes or set YOQA_APPIUM_PORT.`,
	);
}

async function listenersOnPort(port: number): Promise<number[]> {
	const proc = Bun.spawn(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (exitCode !== 0 && !stdout.trim()) {
		return [];
	}
	return [
		...new Set(
			stdout
				.split(/\s+/)
				.map((part) => part.trim())
				.filter(Boolean)
				.map((part) => Number(part))
				.filter((pid) => Number.isInteger(pid) && pid > 0),
		),
	];
}

function clearManagedIfDead(): void {
	if (!appiumProcess) return;
	const exitCode = appiumProcess.proc.exitCode;
	if (exitCode !== null && exitCode !== undefined) {
		appiumProcess = null;
		notifyAppiumStopped();
	}
}

/** Ensure the Appium Server process is running; returns its listen port. */
export async function ensureAppiumServer(): Promise<number> {
	clearManagedIfDead();
	if (appiumProcess) {
		await waitForAppium(appiumProcess.port);
		return appiumProcess.port;
	}

	const appium = await resolveAppium();
	const port = await pickAppiumPort();
	const command = appiumCommand(appium, port);
	ensureAndroidSdkEnv();
	const proc = Bun.spawn(command, {
		cwd: appium.cwd,
		env: { ...process.env, ...appium.env },
		stdout: "ignore",
		stderr: "ignore",
	});
	const startedAt = Date.now();
	const id = `appium-managed-${port}`;
	appiumProcess = { proc, appium, port, startedAt, id };

	void proc.exited.then(() => {
		if (appiumProcess?.proc === proc) {
			appiumProcess = null;
			notifyAppiumStopped();
		}
	});

	await waitForAppium(port);
	return port;
}

export function getManagedAppiumInfo(): ManagedAppiumInfo | null {
	clearManagedIfDead();
	if (!appiumProcess) return null;
	const pid = appiumProcess.proc.pid;
	if (!pid) return null;
	return {
		id: appiumProcess.id,
		kind: "appium",
		ownership: "managed",
		pid,
		port: appiumProcess.port,
		startedAt: appiumProcess.startedAt,
		status: "running",
	};
}

export async function listForeignAppium(): Promise<ForeignAppiumInfo[]> {
	clearManagedIfDead();
	const managed = getManagedAppiumInfo();
	const foreign: ForeignAppiumInfo[] = [];
	const seenPids = new Set<number>();

	for (let offset = 0; offset < APPIUM_PORT_SCAN_COUNT; offset++) {
		const port = DEFAULT_APPIUM_PORT + offset;
		if (managed && managed.port === port) continue;
		const pids = await listenersOnPort(port);
		if (pids.length === 0) continue;
		if (!(await isAppiumStatusOk(port))) continue;

		for (const pid of pids) {
			if (managed && managed.pid === pid) continue;
			if (seenPids.has(pid)) continue;
			seenPids.add(pid);
			foreign.push({
				id: `appium-foreign-${port}-${pid}`,
				kind: "appium",
				ownership: "foreign",
				pid,
				port,
				status: "running",
			});
		}
	}

	return foreign;
}

export async function listAppiumServers(): Promise<Array<ManagedAppiumInfo | ForeignAppiumInfo>> {
	const managed = getManagedAppiumInfo();
	const foreign = await listForeignAppium();
	return managed ? [managed, ...foreign] : foreign;
}

async function killPid(pid: number): Promise<void> {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// Already gone.
	}
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
			await Bun.sleep(100);
		} catch {
			return;
		}
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already gone.
	}
}

export async function stopAppiumServer(): Promise<boolean> {
	clearManagedIfDead();
	if (!appiumProcess) return false;
	const proc = appiumProcess.proc;
	const pid = proc.pid;
	appiumProcess = null;
	try {
		proc.kill();
	} catch {
		// ignore
	}
	if (pid) {
		await killPid(pid);
	}
	notifyAppiumStopped();
	return true;
}

export async function stopForeignAppium(id: string): Promise<boolean> {
	const foreign = await listForeignAppium();
	const target = foreign.find((item) => item.id === id);
	if (!target) return false;
	await killPid(target.pid);
	return true;
}

export async function stopAllForeignAppium(): Promise<number> {
	const foreign = await listForeignAppium();
	for (const item of foreign) {
		await killPid(item.pid);
	}
	return foreign.length;
}

export async function stopAppiumById(id: string): Promise<boolean> {
	const managed = getManagedAppiumInfo();
	if (managed?.id === id) {
		return stopAppiumServer();
	}
	return stopForeignAppium(id);
}

/** Stop managed Appium (if any) then start a fresh managed instance. */
export async function restartAppiumServer(): Promise<number> {
	await stopAppiumServer();
	return ensureAppiumServer();
}

/**
 * Restart semantics for a foreign entry: kill it, then ensure Yoqa-managed Appium.
 */
export async function restartAppiumById(id: string): Promise<number> {
	const managed = getManagedAppiumInfo();
	if (managed?.id === id) {
		return restartAppiumServer();
	}
	const stopped = await stopForeignAppium(id);
	if (!stopped) {
		throw new Error(`Unknown Appium server: ${id}`);
	}
	return ensureAppiumServer();
}
