import type { DevicePlatform } from "@yoqa/runner-client";
import type { BenchmarkDriver } from "./scenario";

export type YoqaBenchmarkClient = {
	connectDevice: (request: {
		deviceId: string;
		platform: DevicePlatform;
		lane?: "appium" | "direct" | "auto";
	}) => Promise<unknown>;
	getScreen: () => Promise<unknown>;
	performAction: (request: {
		kind: "tap";
		x: number;
		y: number;
		screenshot: true;
	}) => Promise<{ screenshot?: { waitedMs?: number } }>;
	disconnectDevice: () => Promise<unknown>;
};

export function yoqaBenchmarkDriver(
	client: YoqaBenchmarkClient,
	options: { deviceId: string; platform: DevicePlatform; lane?: "appium" | "direct" | "auto" },
): BenchmarkDriver {
	return {
		name: "yoqa",
		connect: async () => {
			await client.connectDevice({
				deviceId: options.deviceId,
				platform: options.platform,
				lane: options.lane,
			});
		},
		screen: async () => {
			await client.getScreen();
		},
		tapToResult: async (x, y) => {
			const started = Date.now();
			const result = await client.performAction({ kind: "tap", x, y, screenshot: true });
			const settle = result.screenshot?.waitedMs ?? 0;
			const total = Date.now() - started;
			return {
				phases: {
					action: Math.max(0, total - settle),
					settle,
				},
			};
		},
		disconnect: async () => {
			await client.disconnectDevice();
		},
	};
}
