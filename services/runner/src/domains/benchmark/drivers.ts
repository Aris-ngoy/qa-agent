import type { DevicePlatform, Run, ScreenElement } from "@yoqa/runner-client";
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
	createRun?: (request: {
		appId: string;
		caseIds: string[];
		deviceId: string;
		platform: DevicePlatform;
		executionMode: "agent";
		screenMode?: "vision" | "tree";
		lane?: "appium" | "direct" | "auto";
	}) => Promise<Pick<Run, "id">>;
	waitForRun?: (runId: string) => Promise<Pick<Run, "status" | "tests">>;
};

export function yoqaBenchmarkDriver(
	client: YoqaBenchmarkClient,
	options: {
		deviceId: string;
		platform: DevicePlatform;
		lane?: "appium" | "direct" | "auto";
		screenMode?: "vision" | "tree";
		appId?: string;
	},
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
		runCase:
			client.createRun && client.waitForRun && options.appId
				? async (caseId) => {
						const created = await client.createRun?.({
							appId: options.appId ?? "",
							caseIds: [caseId],
							deviceId: options.deviceId,
							platform: options.platform,
							executionMode: "agent",
							screenMode: options.screenMode,
							lane: options.lane,
						});
						if (!created) return { passed: false };
						const finished = await client.waitForRun?.(created.id);
						const steps = finished?.tests?.reduce((n, test) => n + (test.steps?.length ?? 0), 0);
						return { passed: finished?.status === "passed", steps };
					}
				: undefined,
		disconnect: async () => {
			await client.disconnectDevice();
		},
	};
}
