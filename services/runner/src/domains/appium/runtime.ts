import type { DevicePlatform, SetupPlatformRequest } from "@yoqa/runner-client";
import { loadDevicePrep } from "../ios/application";
import type { DevicePrepRecord } from "../ios/models";
import { ensureRuntime, getRuntimeStatus, resolveAppium, setupPlatform } from "./application";
import {
	APPIUM_HOST,
	APPIUM_PORT_SCAN_COUNT,
	DEFAULT_APPIUM_PORT,
	type RuntimeHost,
	type SpawnedProcess,
	bunHost,
} from "./host";
import { usingHost } from "./host-context";
import type { ForeignAppiumInfo, ManagedAppiumInfo, ResolvedAppium } from "./models";

type ManagedProc = {
	proc: SpawnedProcess;
	port: number;
	startedAt: number;
	id: string;
};

type ServerState = {
	proc: ManagedProc | null;
	onStopped: (() => void) | null;
};

export type AppiumRuntime = {
	getStatus: typeof getRuntimeStatus;
	ensure: typeof ensureRuntime;
	setupPlatform: (
		request: SetupPlatformRequest | DevicePlatform,
	) => ReturnType<typeof setupPlatform>;
	ensureServer: () => Promise<number>;
	readDevicePrep: (deviceId: string) => Promise<DevicePrepRecord | null>;
	managedInfo: () => ManagedAppiumInfo | null;
	setOnStopped: (handler: (() => void) | null) => void;
	stopServer: () => Promise<boolean>;
	listForeign: () => Promise<ForeignAppiumInfo[]>;
	stopForeign: (id: string) => Promise<boolean>;
	stopAllForeign: () => Promise<number>;
};

function notifyStopped(state: ServerState): void {
	try {
		state.onStopped?.();
	} catch {
		// Listeners must not break stop/restart.
	}
}

function clearIfDead(state: ServerState): void {
	if (!state.proc) return;
	const exitCode = state.proc.proc.exitCode;
	if (exitCode !== null && exitCode !== undefined) {
		state.proc = null;
		notifyStopped(state);
	}
}

async function waitUntilListening(
	host: RuntimeHost,
	port: number,
	timeoutMs = 30_000,
): Promise<void> {
	const started = Date.now();
	const url = `http://${APPIUM_HOST}:${port}/status`;
	while (Date.now() - started < timeoutMs) {
		if (await host.httpOk(url)) return;
		await Bun.sleep(400);
	}
	throw new Error(`Appium did not become ready on ${APPIUM_HOST}:${port}`);
}

function appiumCommand(appium: ResolvedAppium, port: number): string[] {
	const args = ["--address", APPIUM_HOST, "--port", String(port), "--relaxed-security"];
	if (appium.invokeViaNode) {
		return [appium.nodeBin ?? "node", appium.bin, ...args];
	}
	return [appium.bin, ...args];
}

async function pickPort(host: RuntimeHost): Promise<number> {
	if (await host.portFree(DEFAULT_APPIUM_PORT)) return DEFAULT_APPIUM_PORT;
	for (let offset = 1; offset <= 20; offset++) {
		const candidate = DEFAULT_APPIUM_PORT + offset;
		if (await host.portFree(candidate)) return candidate;
	}
	throw new Error(
		`No free Appium port near ${DEFAULT_APPIUM_PORT}. Quit other Appium processes or set YOQA_APPIUM_PORT.`,
	);
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

function managedInfo(state: ServerState): ManagedAppiumInfo | null {
	clearIfDead(state);
	if (!state.proc) return null;
	const pid = state.proc.proc.pid;
	if (!pid) return null;
	return {
		id: state.proc.id,
		kind: "appium",
		ownership: "managed",
		pid,
		port: state.proc.port,
		startedAt: state.proc.startedAt,
		status: "running",
	};
}

async function listForeign(host: RuntimeHost, state: ServerState): Promise<ForeignAppiumInfo[]> {
	clearIfDead(state);
	const managed = managedInfo(state);
	const foreign: ForeignAppiumInfo[] = [];
	const seenPids = new Set<number>();

	for (let offset = 0; offset < APPIUM_PORT_SCAN_COUNT; offset++) {
		const port = DEFAULT_APPIUM_PORT + offset;
		if (managed && managed.port === port) continue;
		const pids = await host.listeners(port);
		if (pids.length === 0) continue;
		if (!(await host.httpOk(`http://${APPIUM_HOST}:${port}/status`))) continue;

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

async function ensureListening(host: RuntimeHost, state: ServerState): Promise<number> {
	clearIfDead(state);
	if (state.proc) {
		await waitUntilListening(host, state.proc.port);
		return state.proc.port;
	}

	const appium = await resolveAppium();
	const port = await pickPort(host);
	const command = appiumCommand(appium, port);
	const proc = host.spawn(command, { cwd: appium.cwd, env: appium.env });
	const startedAt = Date.now();
	const managed: ManagedProc = {
		proc,
		port,
		startedAt,
		id: `appium-managed-${port}`,
	};
	state.proc = managed;

	void proc.exited.then(() => {
		if (state.proc?.proc === proc) {
			state.proc = null;
			notifyStopped(state);
		}
	});

	await waitUntilListening(host, port);
	return port;
}

async function stopServer(state: ServerState): Promise<boolean> {
	clearIfDead(state);
	if (!state.proc) return false;
	const proc = state.proc.proc;
	const pid = proc.pid;
	state.proc = null;
	try {
		proc.kill();
	} catch {
		// ignore
	}
	if (pid) await killPid(pid);
	notifyStopped(state);
	return true;
}

/**
 * One Appium Runtime. Callers ask for status, ensure, platform setup
 * (including physical iOS prep), and a listening Appium Server.
 * Device Session attaches; it does not install the runtime.
 */
export function createAppiumRuntime(host: RuntimeHost): AppiumRuntime {
	const state: ServerState = { proc: null, onStopped: null };

	return {
		getStatus: () => usingHost(host, () => getRuntimeStatus()),
		ensure: () => usingHost(host, () => ensureRuntime()),
		setupPlatform: (request) => usingHost(host, () => setupPlatform(request)),
		ensureServer: () => usingHost(host, () => ensureListening(host, state)),
		readDevicePrep: (deviceId) => usingHost(host, () => loadDevicePrep(deviceId)),
		managedInfo: () => managedInfo(state),
		setOnStopped: (handler) => {
			state.onStopped = handler;
		},
		stopServer: () => stopServer(state),
		listForeign: () => listForeign(host, state),
		stopForeign: async (id) => {
			const foreign = await listForeign(host, state);
			const target = foreign.find((item) => item.id === id);
			if (!target) return false;
			await killPid(target.pid);
			return true;
		},
		stopAllForeign: async () => {
			const foreign = await listForeign(host, state);
			for (const item of foreign) {
				await killPid(item.pid);
			}
			return foreign.length;
		},
	};
}

export const productionRuntime = createAppiumRuntime(bunHost);

export const ensureServer = (): Promise<number> => productionRuntime.ensureServer();

export const readDevicePrep = (deviceId: string): Promise<DevicePrepRecord | null> =>
	productionRuntime.readDevicePrep(deviceId);
