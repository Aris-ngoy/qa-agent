/**
 * Stands in for `@/app/desktop-rpc` in the e2e webview (see `vite.e2e.config.ts`): there is
 * no Electrobun host in a plain browser, so the runner calls go to the e2e runner and the
 * host-only requests answer with a fixed value or fail.
 */
import type { DesktopRpcClient } from "@/app/desktop-rpc";
import { RUNNER_URL } from "./harness";

const answers: Record<string, unknown> = {
	ping: "pong",
	getRunnerBaseUrl: RUNNER_URL,
	ensureLocalServices: { baseUrl: RUNNER_URL, started: false },
	restartLocalRunner: { baseUrl: RUNNER_URL, started: false },
	stopLocalRunner: { ok: true },
	openExternalUrl: { ok: true },
};

const client = {
	request: new Proxy(
		{},
		{
			get: (_target, name: string) => async () => {
				if (name in answers) return answers[name];
				throw new Error(`e2e: the desktop host request "${name}" is not stubbed`);
			},
		},
	),
} as DesktopRpcClient;

export function initDesktopRpc(): DesktopRpcClient {
	return client;
}

export function getDesktopRpc(): DesktopRpcClient {
	return client;
}

export async function openExternalUrl(_url: string): Promise<void> {}
