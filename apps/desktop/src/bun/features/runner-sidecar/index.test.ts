import { describe, expect, test } from "bun:test";
import { packagedRunnerCandidates } from "./index";

describe("packagedRunnerCandidates", () => {
	test("includes MacOS and Resources layouts relative to exec roots", () => {
		const paths = packagedRunnerCandidates(["/Apps/YoQA.app/Contents/MacOS"]);
		expect(paths).toContain("/Apps/YoQA.app/Contents/MacOS/yoqa-runner");
		expect(paths).toContain(
			"/Apps/YoQA.app/Contents/Resources/app.asar.unpacked/runner/yoqa-runner",
		);
		expect(paths).toContain("/Apps/YoQA.app/Contents/Resources/runner/yoqa-runner");
	});
});
