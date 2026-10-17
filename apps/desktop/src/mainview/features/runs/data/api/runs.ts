import { bytesToBase64 } from "@/app/download";
import { getRunnerClient } from "@/app/runner-client";
import type { CreateRunRequest, Run } from "@yoqa/runner-client";

export async function getRun(runId: string): Promise<Run> {
	const client = await getRunnerClient();
	return client.getRun(runId);
}

export async function listRuns(appId: string): Promise<Run[]> {
	const client = await getRunnerClient();
	return client.listRuns(appId);
}

export async function createRun(request: CreateRunRequest): Promise<Run> {
	const client = await getRunnerClient();
	return client.createRun(request);
}

export async function cancelRun(runId: string): Promise<Run> {
	const client = await getRunnerClient();
	return client.cancelRun(runId);
}

export async function deleteRun(runId: string): Promise<string> {
	const client = await getRunnerClient();
	await client.deleteRun(runId);
	return runId;
}

export async function deleteRunTestVideo(runId: string, runTestId: string): Promise<void> {
	const client = await getRunnerClient();
	await client.deleteRunTestVideo(runId, runTestId);
}

/** The runner URLs a Run's media loads from: step screenshots and case videos. */
export async function runMediaUrls(runId: string) {
	const client = await getRunnerClient();
	return {
		screenshot: (stepId: string) => client.getRunStepScreenshotUrl(runId, stepId),
		video: (runTestId: string) => client.getRunTestVideoUrl(runId, runTestId),
	};
}

/** Every step screenshot of a Run as base64, keyed by step id, for the exported report. */
export async function readRunScreenshots(
	run: Pick<Run, "id">,
	stepIds: string[],
): Promise<Record<string, string>> {
	const client = await getRunnerClient();
	const screenshots: Record<string, string> = {};
	await Promise.all(
		stepIds.map(async (stepId) => {
			const response = await fetch(client.getRunStepScreenshotUrl(run.id, stepId));
			if (!response.ok) return;
			screenshots[stepId] = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
		}),
	);
	return screenshots;
}
