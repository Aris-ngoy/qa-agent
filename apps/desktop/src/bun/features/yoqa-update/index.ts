import { RunnerClient } from "@yoqa/runner-client";
import { Updater } from "electrobun/bun";
import type { YoqaUpdateStatus, YoqaVersionInfo } from "../../../shared/yoqa-update";
import { type YoqaUpdateController, createYoqaUpdateController } from "./controller";
import { createElectrobunYoqaUpdater } from "./electrobun-updater";

export type { YoqaUpdateController } from "./controller";

/** The installed version and channel, from Electrobun's `version.json`. */
export async function getYoqaVersionInfo(): Promise<YoqaVersionInfo> {
	const info = await Updater.getLocalInfo();
	return { version: info.version, channel: info.channel };
}

const RUNNER_ANSWER_TIMEOUT_MS = 5_000;

/** Build the production Yoqa update controller. Call `start()` once the window is up. */
export async function createYoqaUpdates(
	onStatus: (status: YoqaUpdateStatus) => void,
): Promise<YoqaUpdateController> {
	const { channel } = await getYoqaVersionInfo();
	const runner = new RunnerClient({
		baseUrl: process.env.YOQA_RUNNER_URL ?? "http://127.0.0.1:7420",
		// A runner that doesn't answer in time counts as no Run in progress, like an unreachable one.
		fetchImpl: (input, init) =>
			fetch(input, { ...init, signal: AbortSignal.timeout(RUNNER_ANSWER_TIMEOUT_MS) }),
	});
	return createYoqaUpdateController({
		updater: createElectrobunYoqaUpdater(),
		channel,
		timer: {
			setTimeout: (callback, ms) => setTimeout(callback, ms),
			clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		},
		now: () => Date.now(),
		isRunInProgress: async () => (await runner.listRunsInProgress()).length > 0,
		onStatus,
	});
}
