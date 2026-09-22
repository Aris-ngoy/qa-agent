import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArgentError } from "./cli";
import * as actualCli from "./cli";

type ToolCall = { tool: string; args: string[] };

let toolCalls: ToolCall[] = [];
let describePayload: unknown = { description: "", source: "test" };
let screenshotPayload: unknown = null;
let screenshotError: unknown = null;

mock.module("./cli", () => ({
	...actualCli,
	runArgentTool: async (toolName: string, args: string[] = []) => {
		toolCalls.push({ tool: toolName, args: [...args] });
		if (toolName === "describe") return describePayload;
		if (toolName === "screenshot") {
			if (screenshotError) throw screenshotError;
			return screenshotPayload;
		}
		throw new ArgentError(`unexpected tool in tests: ${toolName}`, "COMMAND_FAILED");
	},
}));

const {
	argentCaptureFrame,
	argentScreenshot,
	argentSnapshotNodes,
	parseArgentDescribe,
	resetArgentScreenForTests,
} = await import("./screen");

const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function writeTempPng(): Promise<string> {
	const path = join(tmpdir(), `yoqa-argent-test-${Date.now()}-${crypto.randomUUID()}.png`);
	await Bun.write(path, Buffer.from(PNG_BASE64, "base64"));
	return path;
}

beforeEach(() => {
	toolCalls = [];
	describePayload = { description: "", source: "test" };
	screenshotPayload = null;
	screenshotError = null;
	resetArgentScreenForTests();
});

describe("parseArgentDescribe", () => {
	test("parses role, label, value, id, and frame onto the 0-1000 grid", () => {
		const nodes = parseArgentDescribe(
			[
				'AXStaticText "21:22"  (0.129, 0.026, 0.109, 0.023)',
				'AXTextField "wifi.rounded" id="wifi.rounded"  (0.1, 0.2, 0.3, 0.04)',
				'AXGroup "Mobile Service" value="No signal"  (0, 0, 1, 0.05)',
			].join("\n"),
		);
		expect(nodes).toHaveLength(3);
		expect(nodes[0]).toMatchObject({
			ref: "argent-0",
			type: "AXStaticText",
			role: "AXStaticText",
			label: "21:22",
			rect: { x: 129, y: 26, width: 109, height: 23 },
		});
		expect(nodes[1]).toMatchObject({ label: "wifi.rounded", identifier: "wifi.rounded" });
		expect(nodes[2]).toMatchObject({ label: "Mobile Service", value: "No signal" });
	});

	test("skips header, blank, and unparseable lines", () => {
		const nodes = parseArgentDescribe(
			[
				"Screen description for sim-1:",
				"",
				'AXButton "OK"  (0.5, 0.5, 0.2, 0.1)',
				"not an element line",
				'AXButton "No frame here"',
			].join("\n"),
		);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toMatchObject({ role: "AXButton", label: "OK" });
	});

	test("keeps zero-area entries for the cleaner to drop", () => {
		const nodes = parseArgentDescribe('AXOther "layout"  (0.1, 0.1, 0, 0)');
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.rect).toEqual({ x: 100, y: 100, width: 0, height: 0 });
	});
});

describe("argentSnapshotNodes", () => {
	test("calls describe and returns the 1000x1000 window", async () => {
		describePayload = {
			description: 'AXStaticText "Hi"  (0.1, 0.2, 0.3, 0.04)',
			source: "ios",
		};
		const { nodes, window } = await argentSnapshotNodes("sim-1");
		expect(toolCalls[0]).toEqual({ tool: "describe", args: ["--udid", "sim-1"] });
		expect(window).toEqual({ width: 1000, height: 1000 });
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.rect).toEqual({ x: 100, y: 200, width: 300, height: 40 });
	});

	test("empty description yields no nodes", async () => {
		describePayload = { description: "", source: "ios" };
		const { nodes, window } = await argentSnapshotNodes("sim-1");
		expect(nodes).toEqual([]);
		expect(window).toEqual({ width: 1000, height: 1000 });
	});
});

describe("argentCaptureFrame", () => {
	test("reads the image path to base64 png", async () => {
		const image = await writeTempPng();
		try {
			screenshotPayload = { image };
			const frame = await argentCaptureFrame("sim-1");
			expect(frame.mime).toBe("image/png");
			expect(frame.base64).toBe(PNG_BASE64);
			expect(toolCalls.filter((c) => c.tool === "screenshot")).toHaveLength(1);
		} finally {
			await rm(image, { force: true });
		}
	});

	test("coalesces within the TTL; fresh bypasses the cache", async () => {
		const image = await writeTempPng();
		try {
			screenshotPayload = { image };
			await argentCaptureFrame("sim-1");
			await argentCaptureFrame("sim-1");
			expect(toolCalls.filter((c) => c.tool === "screenshot")).toHaveLength(1);
			await argentCaptureFrame("sim-1", { fresh: true });
			expect(toolCalls.filter((c) => c.tool === "screenshot")).toHaveLength(2);
		} finally {
			await rm(image, { force: true });
		}
	});

	test("throws when the tool returns no image path", async () => {
		screenshotPayload = { unexpected: true };
		await expect(argentCaptureFrame("sim-1")).rejects.toThrow("no image path");
	});
});

describe("argentScreenshot", () => {
	test("persists under runs/screenshots, never /tmp", async () => {
		const home = await mkdtemp(join(tmpdir(), "yoqa-home-"));
		const previousHome = process.env.HOME;
		process.env.HOME = home;
		const image = await writeTempPng();
		try {
			screenshotPayload = { image };
			const { path, base64 } = await argentScreenshot("sim-1");
			expect(path.startsWith(join(home, ".yoqa", "runs", "screenshots"))).toBe(true);
			expect(await Bun.file(path).exists()).toBe(true);
			expect(base64).toBe(PNG_BASE64);
			await rm(path, { force: true });
		} finally {
			await rm(image, { force: true });
			process.env.HOME = previousHome ?? tmpdir();
			await rm(home, { recursive: true, force: true });
		}
	});
});
