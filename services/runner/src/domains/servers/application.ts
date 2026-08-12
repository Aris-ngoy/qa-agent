import type { DevicePlatform } from "@yoqa/runner-client";
import { loadSettings } from "../../settings";
import {
	type ForeignAppiumInfo,
	type ManagedAppiumInfo,
	getManagedAppiumInfo,
	listAppiumServers,
	listForeignAppium,
	restartAppiumById,
	setOnAppiumStopped,
	stopAllForeignAppium,
	stopAppiumById,
	stopAppiumServer,
} from "../appium/server";
import {
	abandonActiveSession,
	connectDevice,
	disconnectDevice,
	getActiveSessionInfo,
} from "../devices/active-session";

export type ServerAction = "stop" | "restart";

export type ServerEntry = {
	id: string;
	kind: "appium" | "runner" | "device-session";
	ownership: "managed" | "foreign" | "self";
	label: string;
	status: string;
	pid?: number;
	port?: number;
	deviceId?: string;
	platform?: DevicePlatform;
	startedAt?: number;
	actions: ServerAction[];
};

export type ListServersResponse = {
	servers: ServerEntry[];
};

export type ServerMutationResponse = {
	ok: true;
	message: string;
	servers: ServerEntry[];
};

function appiumLabel(info: ManagedAppiumInfo | ForeignAppiumInfo): string {
	const ownership = info.ownership === "managed" ? "Yoqa" : "Foreign";
	return `${ownership} Appium :${info.port}`;
}

function toAppiumEntry(info: ManagedAppiumInfo | ForeignAppiumInfo): ServerEntry {
	return {
		id: info.id,
		kind: "appium",
		ownership: info.ownership,
		label: appiumLabel(info),
		status: info.status,
		pid: info.pid,
		port: info.port,
		startedAt: "startedAt" in info ? info.startedAt : undefined,
		actions: ["stop", "restart"],
	};
}

function runnerEntry(): ServerEntry {
	const settings = loadSettings();
	return {
		id: "runner-self",
		kind: "runner",
		ownership: "self",
		label: `yoqa-runner :${settings.port}`,
		status: "running",
		pid: process.pid,
		port: settings.port,
		actions: [],
	};
}

function sessionEntry(): ServerEntry | null {
	const active = getActiveSessionInfo();
	if (!active) return null;
	return {
		id: "device-session-active",
		kind: "device-session",
		ownership: "managed",
		label: `Device session ${active.platform} ${active.deviceId}`,
		status: active.streamReady ? "connected" : "connecting",
		port: active.mjpegPort,
		deviceId: active.deviceId,
		platform: active.platform,
		startedAt: active.connectedAt,
		actions: ["stop", "restart"],
	};
}

/** Wire Appium death → abandon zombie device session (idempotent). */
export function installAppiumSessionBridge(): void {
	setOnAppiumStopped(() => {
		abandonActiveSession();
	});
}

export async function listServers(): Promise<ListServersResponse> {
	const appium = await listAppiumServers();
	const servers: ServerEntry[] = [runnerEntry(), ...appium.map(toAppiumEntry)];
	const session = sessionEntry();
	if (session) servers.push(session);
	return { servers };
}

export async function stopAllServers(): Promise<ServerMutationResponse> {
	const disconnected = await disconnectDevice();
	const stoppedManaged = await stopAppiumServer();
	const foreignCount = await stopAllForeignAppium();
	const parts: string[] = [];
	if (disconnected) parts.push("disconnected device session");
	if (stoppedManaged) parts.push("stopped managed Appium");
	if (foreignCount > 0) parts.push(`stopped ${foreignCount} foreign Appium`);
	const list = await listServers();
	return {
		ok: true,
		message: parts.length > 0 ? parts.join("; ") : "Nothing to stop",
		servers: list.servers,
	};
}

export async function stopServer(id: string): Promise<ServerMutationResponse> {
	if (id === "runner-self") {
		throw new Error(
			"Cannot stop yoqa-runner over HTTP while it is serving requests. Use the desktop app or CLI runner controls.",
		);
	}

	if (id === "device-session-active") {
		const info = await disconnectDevice();
		const list = await listServers();
		return {
			ok: true,
			message: info ? `Disconnected ${info.platform} ${info.deviceId}` : "No active device session",
			servers: list.servers,
		};
	}

	const stopped = await stopAppiumById(id);
	if (!stopped) {
		throw new Error(`Unknown server: ${id}`);
	}
	const list = await listServers();
	return {
		ok: true,
		message: `Stopped ${id}`,
		servers: list.servers,
	};
}

export async function restartServer(id: string): Promise<ServerMutationResponse> {
	if (id === "runner-self") {
		throw new Error(
			"Cannot restart yoqa-runner over HTTP. Use the desktop app Restart runner control or CLI.",
		);
	}

	if (id === "device-session-active") {
		const current = getActiveSessionInfo();
		if (!current) {
			throw new Error("No active device session to restart");
		}
		await disconnectDevice();
		const info = await connectDevice({
			deviceId: current.deviceId,
			platform: current.platform,
		});
		const list = await listServers();
		return {
			ok: true,
			message: `Restarted device session ${info.platform} ${info.deviceId}`,
			servers: list.servers,
		};
	}

	const managed = getManagedAppiumInfo();
	const foreign = await listForeignAppium();
	const known = managed?.id === id || foreign.some((item) => item.id === id);
	if (!known) {
		throw new Error(`Unknown server: ${id}`);
	}

	const port = await restartAppiumById(id);
	const list = await listServers();
	return {
		ok: true,
		message: `Restarted Appium on port ${port}`,
		servers: list.servers,
	};
}
