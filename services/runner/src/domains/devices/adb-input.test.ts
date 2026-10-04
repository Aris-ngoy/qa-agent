import { describe, expect, test } from "bun:test";
import {
	encodeAdbInputText,
	findDumpNodeBounds,
	parseWmSize,
	stripUiautomatorDump,
} from "./adb-input";

describe("parseWmSize", () => {
	test("prefers an override size when present", () => {
		expect(parseWmSize("Physical size: 1080x2400\nOverride size: 1080x2340\n")).toEqual({
			width: 1080,
			height: 2340,
		});
	});

	test("reads physical size alone", () => {
		expect(parseWmSize("Physical size: 720x1280\n")).toEqual({ width: 720, height: 1280 });
	});
});

describe("encodeAdbInputText", () => {
	test("turns spaces into %s so input text keeps them", () => {
		expect(encodeAdbInputText("hello world")).toBe("hello%sworld");
	});
});

describe("stripUiautomatorDump", () => {
	test("keeps XML after the dump banner", () => {
		const raw = "UI hierchary dumped to: /dev/tty\n<hierarchy></hierarchy>\n";
		expect(stripUiautomatorDump(raw)).toBe("<hierarchy></hierarchy>\n");
	});
});

describe("findDumpNodeBounds", () => {
	test("returns pixel bounds for a matching resource-id", () => {
		const xml = `<hierarchy><node bounds="[10,20][110,80]" resource-id="com.app:id/ok" text="OK" /></hierarchy>`;
		expect(findDumpNodeBounds(xml, (attrs) => attrs["resource-id"] === "com.app:id/ok")).toEqual({
			x: 10,
			y: 20,
			width: 100,
			height: 60,
		});
	});
});
