import type { DevicePlatform, ScreenElement } from "@yoqa/runner-client";
import { tapHitsElement } from "./accuracy";
import type { BenchmarkDriver } from "./scenario";

export type YoqaBenchmarkClient = {
	connectDevice: (request: {
		deviceId: string;
		platform: DevicePlatform;
		lane?: "appium" | "direct" | "auto";
	}) => Promise<unknown>;
	getScreen: () => Promise<{ elements?: ScreenElement[] }>;
	performAction: (request: {
		kind: "tap";
		x: number;
		y: number;
		screenshot: true;
	}) => Promise<{
		screenshot?: { waitedMs?: number };
		phases?: { captureMs?: number; actionMs?: number; settleMs?: number };
	}>;
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
		tapToResult: async (x, y, expect) => {
			const result = await client.performAction({ kind: "tap", x, y, screenshot: true });
			const tree = await client.getScreen().catch(() => ({ elements: [] }));
			const hit = tapHitsElement(tree.elements ?? [], x, y, expect);
			return {
				hit,
				phases: {
					capture: result.phases?.captureMs ?? 0,
					action: result.phases?.actionMs ?? 0,
					settle: result.phases?.settleMs ?? result.screenshot?.waitedMs ?? 0,
				},
			};
		},
		disconnect: async () => {
			await client.disconnectDevice();
		},
	};
}
