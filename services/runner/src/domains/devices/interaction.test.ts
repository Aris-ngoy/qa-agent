import { describe, expect, test } from "bun:test";
import type { ActionRequest } from "@yoqa/runner-client";
import { getScreen, performAction } from "./interaction";
import type { DeviceSession } from "./session";

const ALLOW_XML = `
<hierarchy>
  <android.widget.Button bounds="[400,1800][800,1900]" text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" enabled="true" />
</hierarchy>
`;

function sessionStub(taps: Array<{ x: number; y: number; coordSpace?: string }>): DeviceSession {
	return {
		pageSource: async () => ALLOW_XML,
		getWindowSize: async () => ({ width: 1000, height: 2000 }),
		tap: async (x: number, y: number, options?: { coordSpace?: "window" | "screenshot" }) => {
			taps.push({ x, y, coordSpace: options?.coordSpace });
		},
	} as unknown as DeviceSession;
}

describe("performAction tap locators", () => {
	test("prefers --label over guessed x,y so Allow hits the tree center", async () => {
		const taps: Array<{ x: number; y: number; coordSpace?: string }> = [];
		const body: ActionRequest = {
			kind: "tap",
			label: "Allow",
			x: 269,
			y: 951,
		};
		const result = await performAction(sessionStub(taps), body);
		expect(taps).toEqual([{ x: 600, y: 925, coordSpace: "window" }]);
		expect(result.resolved).toEqual({ x: 600, y: 925 });
	});

	test("prefers --id over guessed x,y", async () => {
		const taps: Array<{ x: number; y: number; coordSpace?: string }> = [];
		await performAction(sessionStub(taps), {
			kind: "tap",
			id: "permission_allow_button",
			x: 1,
			y: 1,
		});
		expect(taps).toEqual([{ x: 600, y: 925, coordSpace: "window" }]);
	});

	test("resolves --label Help & Info against page source with &amp;", async () => {
		const taps: Array<{ x: number; y: number }> = [];
		const xml = `
<hierarchy>
  <android.widget.TextView bounds="[400,1800][800,1900]" text="Help &amp; Info" enabled="true" />
</hierarchy>
`;
		const session = {
			pageSource: async () => xml,
			getWindowSize: async () => ({ width: 1000, height: 2000 }),
			tap: async (x: number, y: number) => {
				taps.push({ x, y });
			},
		} as unknown as DeviceSession;
		const result = await performAction(session, {
			kind: "tap",
			label: "Help & Info",
			x: 500,
			y: 456,
		});
		expect(taps).toEqual([{ x: 600, y: 925 }]);
		expect(result.resolved).toEqual({ x: 600, y: 925 });
	});

	test("coordinate-only taps use screenshot space", async () => {
		const taps: Array<{ x: number; y: number; coordSpace?: string }> = [];
		await performAction(sessionStub(taps), { kind: "tap", x: 120, y: 340 });
		expect(taps).toEqual([{ x: 120, y: 340, coordSpace: "screenshot" }]);
	});
});

describe("performAction swipe", () => {
	test("swipes in screenshot space", async () => {
		const swipes: Array<{
			x: number;
			y: number;
			x2: number;
			y2: number;
			coordSpace?: string;
		}> = [];
		const session = {
			pageSource: async () => "<hierarchy/>",
			getWindowSize: async () => ({ width: 1000, height: 2000 }),
			swipe: async (
				x: number,
				y: number,
				x2: number,
				y2: number,
				_durationMs?: number,
				options?: { coordSpace?: "window" | "screenshot" },
			) => {
				swipes.push({ x, y, x2, y2, coordSpace: options?.coordSpace });
			},
		} as unknown as DeviceSession;
		await performAction(session, { kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 });
		expect(swipes).toEqual([{ x: 500, y: 800, x2: 500, y2: 200, coordSpace: "screenshot" }]);
	});
});

describe("getScreen", () => {
	test("reads the cleaned tree without pausing when pauseMjpeg is false", async () => {
		const session = {
			pageSource: async () => ALLOW_XML,
			getWindowSize: async () => ({ width: 1000, height: 2000 }),
		} as unknown as DeviceSession;
		const screen = await getScreen(session, { pauseMjpeg: false });
		expect(screen.full).toBe(false);
		expect(screen.elements?.[0]).toMatchObject({ label: "Allow" });
	});
});
