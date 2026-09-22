import { describe, expect, test } from "bun:test";
import {
	ARGENT_INSTALL_HINT,
	ARGENT_TELEMETRY_HINT,
	ArgentError,
	argentCandidateBins,
	argentErrorFromStderr,
	isDeadArgentSessionError,
	isSupportedArgentVersion,
	resolveArgentBin,
	runArgentBin,
	runArgentTool,
} from "./cli";

describe("isSupportedArgentVersion", () => {
	test("accepts the enumerated release and newer", () => {
		expect(isSupportedArgentVersion("0.25.2")).toBe(true);
		expect(isSupportedArgentVersion("0.26.0")).toBe(true);
		expect(isSupportedArgentVersion("1.0.0")).toBe(true);
	});

	test("rejects older releases and garbage", () => {
		expect(isSupportedArgentVersion("0.24.9")).toBe(false);
		expect(isSupportedArgentVersion("0.7.6")).toBe(false);
		expect(isSupportedArgentVersion("not-a-version")).toBe(false);
	});
});

describe("argentCandidateBins", () => {
	test("prefers workspace installs before PATH", () => {
		const bins = argentCandidateBins();
		expect(bins[0]).toEndWith("node_modules/.bin/argent");
		expect(bins.some((bin) => bin === "/opt/homebrew/bin/argent")).toBe(true);
	});
});

describe("resolveArgentBin", () => {
	test("resolves to an argent binary or reports TOOL_MISSING", async () => {
		try {
			const bin = await resolveArgentBin();
			expect(bin.endsWith("argent") || bin.endsWith("argent.exe")).toBe(true);
		} catch (error) {
			expect(error).toBeInstanceOf(ArgentError);
			expect((error as ArgentError).code).toBe("TOOL_MISSING");
		}
	});
});

describe("argentErrorFromStderr", () => {
	test("maps a missing device to a dead-session DEVICE_NOT_FOUND", () => {
		const error = argentErrorFromStderr("describe", "Device 9C96DB25 not found", 1);
		expect(error).toBeInstanceOf(ArgentError);
		expect(error.code).toBe("DEVICE_NOT_FOUND");
		expect(isDeadArgentSessionError(error)).toBe(true);
	});

	test("maps a refused tool-server connection to SERVER_UNREACHABLE", () => {
		const error = argentErrorFromStderr(
			"list-devices",
			"connect ECONNREFUSED 127.0.0.1:55598 — is the tool-server running?",
			1,
		);
		expect(error.code).toBe("SERVER_UNREACHABLE");
		expect(isDeadArgentSessionError(error)).toBe(true);
	});

	test("maps an unknown tool to COMMAND_FAILED with a tools hint", () => {
		const error = argentErrorFromStderr(
			"nosuchtool",
			'Tool "nosuchtool" not found. Run `argent tools` to list available tools.',
			1,
		);
		expect(error.code).toBe("COMMAND_FAILED");
		expect(error.hint).toContain("argent tools");
		expect(isDeadArgentSessionError(error)).toBe(false);
	});

	test("falls back to COMMAND_FAILED for anything else", () => {
		const error = argentErrorFromStderr("keyboard", "kaboom", 1);
		expect(error.code).toBe("COMMAND_FAILED");
		expect(error.message).toContain("kaboom");
	});
});

describe("isDeadArgentSessionError", () => {
	test("matches dead codes and plain transport messages", () => {
		expect(isDeadArgentSessionError(new ArgentError("gone", "DEVICE_DISCONNECTED"))).toBe(true);
		expect(isDeadArgentSessionError(new Error("device 123 not found"))).toBe(true);
		expect(isDeadArgentSessionError(new Error("connect ECONNREFUSED"))).toBe(true);
	});

	test("ignores usage errors", () => {
		expect(isDeadArgentSessionError(new ArgentError("nope", "COMMAND_FAILED"))).toBe(false);
		expect(isDeadArgentSessionError(new Error("Tool discussion not found"))).toBe(false);
	});
});

describe("argent install copy", () => {
	test("points at the global install only and surfaces the telemetry opt-out", () => {
		expect(ARGENT_INSTALL_HINT).toContain("npm install -g @swmansion/argent");
		expect(ARGENT_INSTALL_HINT).not.toContain("node_modules");
		expect(ARGENT_TELEMETRY_HINT).toContain("argent telemetry disable");
	});
});

describe("runArgentTool", () => {
	test("times out a hung backend with code TIMEOUT", async () => {
		const error = await runArgentBin("/bin/sleep", ["30"], {
			label: "sleep",
			timeoutMs: 150,
		}).then(
			() => null,
			(error: unknown) => error,
		);
		expect(error).toBeInstanceOf(ArgentError);
		expect((error as ArgentError).code).toBe("TIMEOUT");
	});

	test("lists devices against a live backend (skips when argent is missing)", async () => {
		let bin: string;
		try {
			bin = await resolveArgentBin();
		} catch {
			return;
		}
		const data = (await runArgentTool("list-devices", [], { bin })) as {
			devices?: unknown[];
		};
		expect(Array.isArray(data.devices)).toBe(true);
	});
});
