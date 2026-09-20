import { describe, expect, test } from "bun:test";
import { AgentDeviceError } from "../agent-device/cli";
import { shouldAutoInstallRunnerOnConnect } from "./session";

describe("shouldAutoInstallRunnerOnConnect", () => {
	const signingError = new AgentDeviceError(
		"The AgentDeviceRunner XCTest host must be signed before commands can run",
		"IOS_RUNNER_NOT_INSTALLED",
	);

	test("installs once for an iOS runner-missing failure with a known kind", () => {
		expect(shouldAutoInstallRunnerOnConnect("ios", "physical", signingError)).toBe(true);
		expect(shouldAutoInstallRunnerOnConnect("ios", "simulator", signingError)).toBe(true);
	});

	test("skips when the kind is unknown (cannot target the install)", () => {
		expect(shouldAutoInstallRunnerOnConnect("ios", undefined, signingError)).toBe(false);
	});

	test("skips non-iOS platforms", () => {
		expect(shouldAutoInstallRunnerOnConnect("android", "physical", signingError)).toBe(false);
	});

	test("skips unrelated failures (device gone, busy, unknown device)", () => {
		expect(
			shouldAutoInstallRunnerOnConnect(
				"ios",
				"physical",
				new AgentDeviceError("gone", "SESSION_NOT_FOUND"),
			),
		).toBe(false);
		expect(shouldAutoInstallRunnerOnConnect("ios", "physical", new Error("Device not found"))).toBe(
			false,
		);
	});
});
