import { describe, expect, test } from "bun:test";
import { isDeadSessionError } from "../devices/session";
import {
	AgentDeviceError,
	IOS_RUNNER_NOT_INSTALLED_CODE,
	agentDeviceErrorFromEnvelope,
	agentDeviceSessionName,
	conflictingSessionAddress,
	isDeadAgentDeviceSessionError,
	isRunnerNotInstalledError,
	isSameDaemonDeviceInUse,
	isSupportedAgentDeviceVersion,
} from "./cli";

describe("agentDeviceSessionName", () => {
	test("slugifies a UDID into a stable session name", () => {
		expect(agentDeviceSessionName("9C96DB25-8319-4E62-9808-8626EC6250F0")).toBe(
			"yoqa-9c96db25-8319-4e62-9808-8626ec6250f0",
		);
	});

	test("slugifies an adb serial", () => {
		expect(agentDeviceSessionName("emulator-5554")).toBe("yoqa-emulator-5554");
	});

	test("falls back for blank ids", () => {
		expect(agentDeviceSessionName("  ")).toBe("yoqa-device");
	});
});

describe("isSupportedAgentDeviceVersion", () => {
	test("accepts current and newer releases", () => {
		expect(isSupportedAgentDeviceVersion("0.21.6")).toBe(true);
		expect(isSupportedAgentDeviceVersion("0.22.0")).toBe(true);
		expect(isSupportedAgentDeviceVersion("1.0.0")).toBe(true);
	});

	test("rejects older releases and garbage", () => {
		expect(isSupportedAgentDeviceVersion("0.7.6")).toBe(false);
		expect(isSupportedAgentDeviceVersion("0.20.9")).toBe(false);
		expect(isSupportedAgentDeviceVersion("not-a-version")).toBe(false);
	});
});

describe("agentDeviceErrorFromEnvelope", () => {
	test("re-codes the Developer Mode gate and appends the repair path", () => {
		const error = agentDeviceErrorFromEnvelope({
			code: "COMMAND_FAILED",
			message: "Developer mode is disabled for Apple development tools",
			hint: "Run `sudo DevToolsSecurity -enable`, then retry the iOS runner.",
		});
		expect(error).toBeInstanceOf(AgentDeviceError);
		expect(error.code).toBe("DEVELOPER_MODE_DISABLED");
		expect(error.message).toBe("Developer mode is disabled for Apple development tools");
		expect(error.hint).toContain("sudo DevToolsSecurity -enable");
		expect(error.hint).toContain("yoqa doctor --fix");
	});

	test("leaves other COMMAND_FAILED errors untouched", () => {
		const error = agentDeviceErrorFromEnvelope({
			code: "COMMAND_FAILED",
			message: "No active session. Run open first.",
		});
		expect(error.code).toBe("COMMAND_FAILED");
		expect(error.hint).toBeUndefined();
	});

	test("re-codes a missing-runner COMMAND_FAILED to IOS_RUNNER_NOT_INSTALLED", () => {
		const error = agentDeviceErrorFromEnvelope({
			code: "COMMAND_FAILED",
			message: "The AgentDeviceRunner XCTest host must be signed before commands can run",
			hint: "Start with Automatic Signing and only these env vars: AGENT_DEVICE_IOS_TEAM_ID=ABCDE12345",
		});
		expect(error.code).toBe(IOS_RUNNER_NOT_INSTALLED_CODE);
		expect(error.hint).toContain("YoqaADRunner");
	});
});

describe("runner-missing detection", () => {
	test("matches the re-coded error and raw signing messages", () => {
		expect(
			isRunnerNotInstalledError(
				new AgentDeviceError("must be signed", IOS_RUNNER_NOT_INSTALLED_CODE),
			),
		).toBe(true);
		expect(
			isRunnerNotInstalledError(new AgentDeviceError("boom", "IOS_RUNNER_DEVICE_NOT_PROVISIONED")),
		).toBe(true);
		expect(
			isRunnerNotInstalledError(
				new Error("xcodebuild build-for-testing failed: requires a development team"),
			),
		).toBe(true);
		expect(
			isRunnerNotInstalledError(new Error("set AGENT_DEVICE_IOS_TEAM_ID for physical runs")),
		).toBe(true);
	});

	test("ignores dead sessions, in-use claims, and unknown devices", () => {
		expect(isRunnerNotInstalledError(new AgentDeviceError("gone", "SESSION_NOT_FOUND"))).toBe(
			false,
		);
		expect(isRunnerNotInstalledError(new Error("already in use by session"))).toBe(false);
		expect(isRunnerNotInstalledError(new Error("Device not found"))).toBe(false);
	});
});

describe("dead session detection", () => {
	test("SESSION_NOT_FOUND is a dead session", () => {
		expect(
			isDeadAgentDeviceSessionError(new AgentDeviceError("No active session", "SESSION_NOT_FOUND")),
		).toBe(true);
	});

	test("isDeadSessionError covers agent-device errors and legacy messages", () => {
		expect(isDeadSessionError(new AgentDeviceError("No active session", "SESSION_NOT_FOUND"))).toBe(
			true,
		);
		expect(isDeadSessionError(new Error("invalid session id"))).toBe(true);
		expect(isDeadSessionError(new Error("DEVICE_IN_USE by another session"))).toBe(false);
	});
});

describe("same-daemon DEVICE_IN_USE", () => {
	const leftover = 'Device is already in use by session "cwd:fcfcd77c2e6b136e:ios".';
	const owned =
		'Device is owned by session "cwd:abc:ios" in workspace /tmp/other — never retriable.';

	test("reads the session from envelope detail JSON", () => {
		const error = new AgentDeviceError(
			leftover,
			"DEVICE_IN_USE",
			undefined,
			JSON.stringify({ session: "cwd:fcfcd77c2e6b136e:ios", deviceId: "udid" }),
		);
		expect(isSameDaemonDeviceInUse(error)).toBe(true);
		expect(conflictingSessionAddress(error)).toBe("cwd:fcfcd77c2e6b136e:ios");
	});

	test("falls back to the message when detail is missing", () => {
		const error = new AgentDeviceError(leftover, "DEVICE_IN_USE");
		expect(conflictingSessionAddress(error)).toBe("cwd:fcfcd77c2e6b136e:ios");
	});

	test("parses a plain Error message", () => {
		expect(isSameDaemonDeviceInUse(new Error(leftover))).toBe(true);
		expect(conflictingSessionAddress(new Error(leftover))).toBe("cwd:fcfcd77c2e6b136e:ios");
	});

	test("does not steal a workspace-owned claim", () => {
		const error = new AgentDeviceError(owned, "DEVICE_IN_USE");
		expect(isSameDaemonDeviceInUse(error)).toBe(false);
		expect(conflictingSessionAddress(error)).toBeNull();
	});

	test("ignores unrelated errors", () => {
		expect(
			isSameDaemonDeviceInUse(new AgentDeviceError("No active session", "SESSION_NOT_FOUND")),
		).toBe(false);
		expect(conflictingSessionAddress(new Error("open failed"))).toBeNull();
	});
});
