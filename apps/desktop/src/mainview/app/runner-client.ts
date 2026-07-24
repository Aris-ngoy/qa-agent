import { getDesktopRpc } from "@/app/desktop-rpc";
import { type RunnerClient, createRunnerClient } from "@yoqa/runner-client";

export async function getRunnerClient(): Promise<RunnerClient> {
	const baseUrl = await getDesktopRpc().request.getRunnerBaseUrl();
	return createRunnerClient({ baseUrl });
}
