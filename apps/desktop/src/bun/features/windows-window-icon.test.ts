import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { packagedWindowIconPath } from "./windows-window-icon";

describe("packagedWindowIconPath", () => {
	test("points at Resources/app.ico next to the app's bin folder", () => {
		const bin = join("C:", "Apps", "yoqa", "bin");
		expect(packagedWindowIconPath(join(bin, "bun.exe"))).toBe(
			join("C:", "Apps", "yoqa", "Resources", "app.ico"),
		);
	});
});
