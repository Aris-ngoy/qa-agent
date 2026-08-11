import { describe, expect, test } from "bun:test";
import {
	type RunnerHealthSnapshot,
	isCompatibleRunnerHealth,
	isLocalRunnerUrl,
	packagedRunnerCandidates,
} from "./index";

describe("packagedRunnerCandidates", () => {
	test("includes MacOS and Resources layouts relative to exec roots", () => {
		const paths = packagedRunnerCandidates(["/Apps/Yoqa.app/Contents/MacOS"]);
		expect(paths).toContain("/Apps/Yoqa.app/Contents/MacOS/yoqa-runner");
		expect(paths).toContain(
			"/Apps/Yoqa.app/Contents/Resources/app.asar.unpacked/runner/yoqa-runner",
		);
		expect(paths).toContain("/Apps/Yoqa.app/Contents/Resources/runner/yoqa-runner");
	});
});

describe("isCompatibleRunnerHealth", () => {
	const healthy = (version: string): RunnerHealthSnapshot => ({
		ok: true,
		service: "yoqa-runner",
		version,
	});

	test("accepts matching version", () => {
		expect(isCompatibleRunnerHealth(healthy("0.3.7"), "0.3.7")).toBe(true);
	});

	test("rejects stale version on the same port", () => {
		expect(isCompatibleRunnerHealth(healthy("0.3.5"), "0.3.7")).toBe(false);
	});

	test("rejects missing health", () => {
		expect(isCompatibleRunnerHealth(null, "0.3.7")).toBe(false);
	});
});

describe("isLocalRunnerUrl", () => {
	test("treats loopback as local", () => {
		expect(isLocalRunnerUrl("http://127.0.0.1:7420")).toBe(true);
		expect(isLocalRunnerUrl("http://localhost:7420/")).toBe(true);
	});

	test("treats remote hosts as non-local", () => {
		expect(isLocalRunnerUrl("http://10.0.0.8:7420")).toBe(false);
		expect(isLocalRunnerUrl("not-a-url")).toBe(false);
	});
});
