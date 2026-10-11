import { getRunnerClient } from "@/app/runner-client";

export async function readScreen(options?: { full?: boolean; pauseMjpeg?: boolean }) {
	const client = await getRunnerClient();
	return client.getScreen(options);
}

export async function readScreenshotBytes() {
	const client = await getRunnerClient();
	return client.fetchScreenshotBytes();
}

export async function mjpegStreamUrl() {
	const client = await getRunnerClient();
	return client.getStreamMjpegUrl();
}

export async function controlSocketUrl() {
	const client = await getRunnerClient();
	return client.getControlWsUrl();
}
