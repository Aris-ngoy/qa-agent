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

/** Build the production Yoqa update controller. Call `start()` once the window is up. */
export async function createYoqaUpdates(
	onStatus: (status: YoqaUpdateStatus) => void,
): Promise<YoqaUpdateController> {
	const { channel } = await getYoqaVersionInfo();
	return createYoqaUpdateController({
		updater: createElectrobunYoqaUpdater(),
		channel,
		timer: {
			setTimeout: (callback, ms) => setTimeout(callback, ms),
			clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
		},
		now: () => Date.now(),
		onStatus,
	});
}
