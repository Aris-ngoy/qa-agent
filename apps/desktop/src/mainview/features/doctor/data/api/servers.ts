import { getDesktopRpc } from "@/app/desktop-rpc";
import { getRunnerClient } from "@/app/runner-client";
import { isRunnerRow } from "@/features/doctor/utils/servers";
import type { ServerEntry } from "@yoqa/runner-client";

export async function listServers() {
	return (await getRunnerClient()).listServers();
}

export async function stopAllServers() {
	return (await getRunnerClient()).stopAllServers();
}

/** Stop one server; the runner itself is stopped by the desktop host, not over its own API. */
export async function stopServer(entry: ServerEntry): Promise<void> {
	if (isRunnerRow(entry)) {
		await getDesktopRpc().request.stopLocalRunner();
		return;
	}
	await (await getRunnerClient()).stopServer(entry.id);
}

/** Restart one server; the runner itself is restarted by the desktop host. */
export async function restartServer(entry: ServerEntry): Promise<void> {
	if (isRunnerRow(entry)) {
		await getDesktopRpc().request.restartLocalRunner();
		return;
	}
	await (await getRunnerClient()).restartServer(entry.id);
}
