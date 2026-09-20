import { describe, expect, test } from "bun:test";
import type { ActionRequest } from "@yoqa/runner-client";
import { getScreen, performAction } from "./interaction";
import type { DeviceSession, SnapshotNode } from "./session";

const ALLOW_NODES: SnapshotNode[] = [
	{
		ref: "e1",
		type: "android.widget.Button",
		role: "button",
		label: "Allow",
		identifier: "com.android.permissioncontroller:id/permission_allow_button",
		rect: { x: 400, y: 1800, width: 400, height: 100 },
		enabled: true,
	},
];

function sessionStub(
	taps: Array<{ x: number; y: number }>,
	nodes: SnapshotNode[] = ALLOW_NODES,
): DeviceSession {
	return {
		snapshotNodes: async () => ({ nodes, window: { width: 1000, height: 2000 } }),
		getWindowSize: async () => ({ width: 1000, height: 2000 }),
		tap: async (x: number, y: number) => {
			taps.push({ x, y });
		},
	} as unknown as DeviceSession;
}

describe("performAction tap locators", () => {
	test("prefers --label over guessed x,y so Allow hits the tree center", async () => {
		const taps: Array<{ x: number; y: number }> = [];
		const body: ActionRequest = {
			kind: "tap",
			label: "Allow",
			x: 269,
			y: 951,
		};
		const result = await performAction(sessionStub(taps), body);
		expect(taps).toEqual([{ x: 600, y: 925 }]);
		expect(result.resolved).toEqual({ x: 600, y: 925 });
	});

	test("prefers --id over guessed x,y", async () => {
		const taps: Array<{ x: number; y: number }> = [];
		await performAction(sessionStub(taps), {
			kind: "tap",
			id: "permission_allow_button",
			x: 1,
			y: 1,
		});
		expect(taps).toEqual([{ x: 600, y: 925 }]);
	});

	test("resolves --label Help & Info", async () => {
		const taps: Array<{ x: number; y: number }> = [];
		const nodes: SnapshotNode[] = [
			{
				ref: "e2",
				type: "android.widget.TextView",
				role: "text",
				label: "Help & Info",
				rect: { x: 400, y: 1800, width: 400, height: 100 },
				enabled: true,
			},
		];
		const result = await performAction(sessionStub(taps, nodes), {
			kind: "tap",
			label: "Help & Info",
			x: 500,
			y: 456,
		});
		expect(taps).toEqual([{ x: 600, y: 925 }]);
		expect(result.resolved).toEqual({ x: 600, y: 925 });
	});

	test("coordinate-only taps use the given 0–1000 point", async () => {
		const taps: Array<{ x: number; y: number }> = [];
		await performAction(sessionStub(taps), { kind: "tap", x: 120, y: 340 });
		expect(taps).toEqual([{ x: 120, y: 340 }]);
	});
});

describe("performAction swipe", () => {
	test("swipes with the given 0–1000 points", async () => {
		const swipes: Array<{
			x: number;
			y: number;
			x2: number;
			y2: number;
		}> = [];
		const session = {
			snapshotNodes: async () => ({ nodes: [], window: { width: 1000, height: 2000 } }),
			getWindowSize: async () => ({ width: 1000, height: 2000 }),
			swipe: async (x: number, y: number, x2: number, y2: number) => {
				swipes.push({ x, y, x2, y2 });
			},
		} as unknown as DeviceSession;
		await performAction(session, { kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 });
		expect(swipes).toEqual([{ x: 500, y: 800, x2: 500, y2: 200 }]);
	});
});

describe("performAction system actions", () => {
	function systemStub(calls: string[]): DeviceSession {
		return {
			back: async () => {
				calls.push("back");
			},
			scroll: async (direction: string, amount?: number) => {
				calls.push(`scroll:${direction}:${amount ?? ""}`);
			},
			home: async () => {
				calls.push("home");
			},
			keyboard: async (action: string) => {
				calls.push(`keyboard:${action}`);
			},
		} as unknown as DeviceSession;
	}

	test("back delegates to the session", async () => {
		const calls: string[] = [];
		const result = await performAction(systemStub(calls), { kind: "back" });
		expect(calls).toEqual(["back"]);
		expect(result).toEqual({ ok: true, kind: "back" });
	});

	test("scroll passes direction and amount", async () => {
		const calls: string[] = [];
		await performAction(systemStub(calls), { kind: "scroll", direction: "down", amount: 0.5 });
		expect(calls).toEqual(["scroll:down:0.5"]);
	});

	test("scroll without direction is a validation error", async () => {
		const calls: string[] = [];
		await expect(performAction(systemStub(calls), { kind: "scroll" })).rejects.toThrow(
			"--direction",
		);
		expect(calls).toEqual([]);
	});

	test("home delegates to the session", async () => {
		const calls: string[] = [];
		await performAction(systemStub(calls), { kind: "home" });
		expect(calls).toEqual(["home"]);
	});

	test("keyboard defaults to dismiss", async () => {
		const calls: string[] = [];
		await performAction(systemStub(calls), { kind: "keyboard" });
		expect(calls).toEqual(["keyboard:dismiss"]);
	});
});

describe("getScreen", () => {
	test("reads the cleaned tree from snapshot nodes", async () => {
		const session = {
			snapshotNodes: async () => ({
				nodes: ALLOW_NODES,
				window: { width: 1000, height: 2000 },
			}),
			getWindowSize: async () => ({ width: 1000, height: 2000 }),
		} as unknown as DeviceSession;
		const screen = await getScreen(session, { pauseMjpeg: false });
		expect(screen.full).toBe(false);
		expect(screen.elements?.[0]).toMatchObject({ label: "Allow" });
	});
});
