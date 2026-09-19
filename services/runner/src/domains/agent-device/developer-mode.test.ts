import { describe, expect, test } from "bun:test";
import { AgentDeviceError } from "./cli";
import {
	DEVELOPER_MODE_DISABLED_MESSAGE,
	classifyDeveloperModeStatus,
	isDeveloperModeDisabledText,
} from "./developer-mode";

describe("isDeveloperModeDisabledText", () => {
	test("matches the agent-device gate message", () => {
		expect(isDeveloperModeDisabledText(DEVELOPER_MODE_DISABLED_MESSAGE)).toBe(true);
	});

	test("matches DevToolsSecurity status output", () => {
		expect(isDeveloperModeDisabledText("Developer mode is currently disabled.")).toBe(true);
	});

	test("rejects unrelated failures", () => {
		expect(isDeveloperModeDisabledText("DEVICE_IN_USE by another session")).toBe(false);
		expect(isDeveloperModeDisabledText("No active session. Run open first.")).toBe(false);
		expect(isDeveloperModeDisabledText("")).toBe(false);
	});
});

describe("classifyDeveloperModeStatus", () => {
	test("disabled output is a warning (simulators still work)", () => {
		expect(classifyDeveloperModeStatus("Developer mode is currently disabled.")).toBe("warn");
	});

	test("enabled output passes", () => {
		expect(classifyDeveloperModeStatus("Developer mode is currently enabled.")).toBe("pass");
	});
});

describe("gate error classification", () => {
	test("AgentDeviceError preserves an explicit code", () => {
		const error = new AgentDeviceError("No active session", "SESSION_NOT_FOUND");
		expect(error.code).toBe("SESSION_NOT_FOUND");
		expect(error.message).toBe("No active session");
	});
});
