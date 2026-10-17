import { getDesktopRpc } from "@/app/desktop-rpc";
import { createRunnerClient } from "@yoqa/runner-client";

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Start the local services and wait until the runner answers from the webview (CORS /
 * loopback). Resolves false when `signal` aborts first; throws when the runner never answers.
 */
export async function startLocalServices(signal: AbortSignal): Promise<boolean> {
	const { baseUrl } = await getDesktopRpc().request.ensureLocalServices();
	if (signal.aborted) return false;

	const client = createRunnerClient({ baseUrl });
	for (let i = 0; i < 20; i++) {
		if (signal.aborted) return false;
		try {
			await client.health();
			return true;
		} catch {
			await sleep(250);
		}
	}
	throw new Error("Local runner started but is not reachable yet. Retry.");
}
