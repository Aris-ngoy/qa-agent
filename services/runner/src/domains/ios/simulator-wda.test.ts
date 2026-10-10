import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forceSimulatorWdaRebuild } from "./simulator-wda";

const SIM_UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";

/** A simulator WebDriverAgent build, as Appium leaves it in its derived data. */
async function builtWda(): Promise<string> {
	const dir = join(await mkdtemp(join(tmpdir(), "wda-sim-")), "wda-sim");
	await mkdir(join(dir, "Build", "Products"), { recursive: true });
	await writeFile(join(dir, "Build", "Products", "WebDriverAgentRunner-Runner.app"), "app");
	return dir;
}

describe("forceSimulatorWdaRebuild", () => {
	test("a forced setup for an iOS simulator forgets the WebDriverAgent build", async () => {
		const dir = await builtWda();
		const forgotten = await forceSimulatorWdaRebuild(
			{ platform: "ios", deviceId: SIM_UDID, kind: "simulator", force: true },
			dir,
		);
		expect(forgotten).toBe(true);
		expect(existsSync(dir)).toBe(false);
	});

	test("keeps the build when the setup is not forced, or not for an iOS simulator", async () => {
		const dir = await builtWda();
		for (const request of [
			{ platform: "ios" as const, deviceId: SIM_UDID, kind: "simulator" as const },
			{
				platform: "ios" as const,
				deviceId: "00008120-000E6D813E2A601E",
				kind: "physical" as const,
				force: true,
			},
			{
				platform: "android" as const,
				deviceId: "emulator-5554",
				kind: "emulator" as const,
				force: true,
			},
		]) {
			expect(await forceSimulatorWdaRebuild(request, dir)).toBe(false);
		}
		expect(existsSync(dir)).toBe(true);
	});

	test("a forced setup with no build yet has nothing to forget and does not fail", async () => {
		const dir = join(await mkdtemp(join(tmpdir(), "wda-sim-")), "never-built");
		expect(
			await forceSimulatorWdaRebuild(
				{ platform: "ios", deviceId: SIM_UDID, kind: "simulator", force: true },
				dir,
			),
		).toBe(true);
	});
});
