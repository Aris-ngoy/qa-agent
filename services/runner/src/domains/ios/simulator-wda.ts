import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SetupPlatformRequest } from "@yoqa/runner-client";

/**
 * Where Appium builds an iOS simulator's WebDriverAgent (its `derivedDataPath`). The first
 * simulator session compiles it here; later sessions reuse the build.
 */
export const SIMULATOR_WDA_DERIVED_DATA = join(homedir(), ".yoqa", "wda-sim");

/**
 * A forced setup (`--force`) for an iOS simulator rebuilds its WebDriverAgent: Appium
 * reuses the build in its derived data, so forgetting it makes the next Appium session
 * compile WDA from scratch. True when the build was forgotten; any other setup keeps it.
 */
export async function forceSimulatorWdaRebuild(
	request: SetupPlatformRequest,
	derivedData = SIMULATOR_WDA_DERIVED_DATA,
): Promise<boolean> {
	if (request.platform !== "ios" || request.kind !== "simulator" || request.force !== true) {
		return false;
	}
	await rm(derivedData, { recursive: true, force: true });
	return true;
}
