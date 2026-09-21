import type { DevicePlatform } from "@yoqa/runner-client";
import { loadSettings } from "../../settings";
import { connectDevice, disconnectDevice, getActiveSessionInfo } from "../devices/active-session";

export type ServerAction = "stop" | "restart";

export type ServerEntry = {
	id: string;
	kind: "argent" | "runner" | "device-session";
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
		status: active.heldByRun ? "in-use" : "connected",
		deviceId: active.deviceId,
		platform: active.platform,
		startedAt: active.connectedAt,
		actions: ["stop", "restart"],
	};
}

export async function listServers(): Promise<ListServersResponse> {
	const servers: ServerEntry[] = [runnerEntry()];
	const session = sessionEntry();
	if (session) servers.push(session);
	return { servers };
}

export async function stopAllServers(): Promise<ServerMutationResponse> {
	const disconnected = await disconnectDevice();
	const list = await listServers();
	return {
		ok: true,
		message: disconnected
			? `Disconnected device session ${disconnected.platform} ${disconnected.deviceId}`
			: "Nothing to stop",
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

	throw new Error(`Unknown server: ${id}`);
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

	throw new Error(`Unknown server: ${id}`);
}
