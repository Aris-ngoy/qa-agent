import { describe, expect, test } from "bun:test";
import {
	DeadSessionError,
	isDeadSessionError,
	parseDescribeToNodes,
	screenshotPathFromResult,
} from "./session";

const WINDOW = { width: 400, height: 800 };

describe("parseDescribeToNodes", () => {
	test("parses framed lines into pixel rects", () => {
		const nodes = parseDescribeToNodes(
			{
				description: [
					'- Button "Log in" [interactable] frame: x=0.25 y=0.5 w=0.5 h=0.1',
					"Tap an element using the centre of its frame.",
				].join("\n"),
			},
			WINDOW,
		);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({
			ref: "a0",
			label: "Log in",
			rect: { x: 100, y: 400, width: 200, height: 80 },
		});
	});

	test("parses Android uiautomator source bounds", () => {
		const nodes = parseDescribeToNodes(
			{
				description: "",
				source:
					'<hierarchy><node class="android.widget.Button" text="Allow" resource-id="com.example:id/allow" bounds="[100,400][300,480]" /></hierarchy>',
			},
			WINDOW,
		);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({
			label: "Allow",
			identifier: "com.example:id/allow",
			rect: { x: 100, y: 400, width: 200, height: 80 },
		});
	});

	test("empty describe yields no nodes (screenshot-first still works)", () => {
		expect(parseDescribeToNodes({ description: "" }, WINDOW)).toEqual([]);
	});
});

describe("screenshotPathFromResult", () => {
	test("extracts Argent's self-chosen capture path", () => {
		expect(
			screenshotPathFromResult("Saved screenshot: /var/folders/x/T/simserver-Ab/media/1-2.png"),
		).toBe("/var/folders/x/T/simserver-Ab/media/1-2.png");
		expect(screenshotPathFromResult({ path: "/tmp/a.png" })).toBe("/tmp/a.png");
		expect(screenshotPathFromResult({ image: "abc" })).toBeNull();
		expect(screenshotPathFromResult("unexpected output")).toBeNull();
	});
});

describe("isDeadSessionError", () => {
	test("matches Argent transport losses", () => {
		expect(isDeadSessionError(new DeadSessionError())).toBe(true);
		expect(isDeadSessionError(new Error("transport not wired for this device"))).toBe(true);
		expect(isDeadSessionError(new Error("Device is busy with another action"))).toBe(false);
	});
});
