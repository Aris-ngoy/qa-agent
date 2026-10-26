import { describe, expect, test } from "bun:test";
import {
	type RunnerHealthSnapshot,
	isCompatibleRunnerHealth,
	isLocalRunnerUrl,
	packagedRunnerCandidates,
	parseListenerPids,
	shouldReuseExistingRunner,
} from "./index";

describe("parseListenerPids", () => {
	test("reads lsof -t output on macOS/Linux, deduped", () => {
		expect(parseListenerPids("4821\n4821\n5010\n", 7420, "darwin")).toEqual([4821, 5010]);
		expect(parseListenerPids("", 7420, "linux")).toEqual([]);
	});

	test("picks only listening TCP rows on the port from netstat -ano on Windows", () => {
		const netstat = [
			"",
			"Active Connections",
			"",
			"  Proto  Local Address          Foreign Address        State           PID",
			"  TCP    127.0.0.1:7420         0.0.0.0:0              LISTENING       25608",
			"  TCP    127.0.0.1:7420         127.0.0.1:51234        ESTABLISHED     25608",
			"  TCP    127.0.0.1:51234        127.0.0.1:7420         ESTABLISHED     9001",
			"  TCP    127.0.0.1:74200        0.0.0.0:0              LISTENING       777",
			"  TCP    [::1]:7420             [::]:0                 ABHÖREN         31337",
			"  TCP    127.0.0.1:7420         127.0.0.1:50000        TIME_WAIT       0",
			"  UDP    0.0.0.0:7420           *:*                                    555",
		].join("\r\n");
		expect(parseListenerPids(netstat, 7420, "win32")).toEqual([25608, 31337]);
	});
});

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

describe("shouldReuseExistingRunner", () => {
	const healthy = (version: string): RunnerHealthSnapshot => ({
		ok: true,
		service: "yoqa-runner",
		version,
	});

	test("reuses a matching runner this process started", () => {
		expect(
			shouldReuseExistingRunner({
				health: healthy("0.3.7"),
				expectedVersion: "0.3.7",
				isOurChild: true,
				isLocal: true,
			}),
		).toBe(true);
	});

	test("replaces a leftover local runner from a previous launch", () => {
		expect(
			shouldReuseExistingRunner({
				health: healthy("0.3.7"),
				expectedVersion: "0.3.7",
				isOurChild: false,
				isLocal: true,
			}),
		).toBe(false);
	});

	test("reuses a matching remote YOQA_RUNNER_URL", () => {
		expect(
			shouldReuseExistingRunner({
				health: healthy("0.3.7"),
				expectedVersion: "0.3.7",
				isOurChild: false,
				isLocal: false,
			}),
		).toBe(true);
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
