import { describe, expect, test } from "bun:test";
import type { YoqaUpdateStatus } from "@/../shared/yoqa-update";
import {
	failedPromptText,
	lastCheckedText,
	readyPromptText,
	releasePageUrl,
	restartHeldText,
	updateStatusText,
} from "./yoqa-update-copy";

describe("readyPromptText", () => {
	test("names the version that is ready", () => {
		expect(readyPromptText("1.0.9")).toBe("Yoqa v1.0.9 is ready");
	});
});

describe("restartHeldText", () => {
	test("says why Restart is disabled while a Run is in progress", () => {
		expect(restartHeldText(true)).toBe("Waiting for the Run to finish");
	});

	test("says nothing once the restart is no longer held", () => {
		expect(restartHeldText(false)).toBeNull();
	});
});

describe("failedPromptText", () => {
	test("names the version that failed and says the old one still runs", () => {
		expect(failedPromptText("1.0.9")).toBe(
			"Yoqa v1.0.9 couldn't be installed, so Yoqa kept the version you had",
		);
	});
});

describe("releasePageUrl", () => {
	test("links the GitHub release for that version", () => {
		expect(releasePageUrl("1.0.9")).toBe(
			"https://github.com/Aris-ngoy/qa-agent/releases/tag/v1.0.9",
		);
	});
});

describe("lastCheckedText", () => {
	const now = Date.UTC(2026, 10, 19, 12, 0, 0);
	const minute = 60_000;

	test("says Yoqa hasn't checked yet", () => {
		expect(lastCheckedText(null, now)).toBe("Not checked yet");
	});

	test("rounds down to the largest whole unit", () => {
		expect(lastCheckedText(now - 20_000, now)).toBe("Last checked just now");
		expect(lastCheckedText(now - minute, now)).toBe("Last checked 1 minute ago");
		expect(lastCheckedText(now - 59 * minute, now)).toBe("Last checked 59 minutes ago");
		expect(lastCheckedText(now - 60 * minute, now)).toBe("Last checked 1 hour ago");
		expect(lastCheckedText(now - 6.5 * 60 * minute, now)).toBe("Last checked 6 hours ago");
		expect(lastCheckedText(now - 3 * 24 * 60 * minute, now)).toBe("Last checked 3 days ago");
	});

	test("treats a check stamped slightly in the future as just now", () => {
		expect(lastCheckedText(now + 5_000, now)).toBe("Last checked just now");
	});
});

describe("updateStatusText", () => {
	const idle: YoqaUpdateStatus = {
		state: "idle",
		version: null,
		lastCheckedAt: null,
		lastError: null,
		restartHeld: false,
	};

	test("says nothing is known before the first check", () => {
		expect(updateStatusText(idle, "stable")).toBe("Yoqa hasn't checked for updates yet");
	});

	test("says Yoqa is up to date after a clean check", () => {
		expect(updateStatusText({ ...idle, lastCheckedAt: 1 }, "stable")).toBe("Yoqa is up to date");
	});

	test("follows a check through download to ready", () => {
		expect(updateStatusText({ ...idle, state: "checking" }, "stable")).toBe(
			"Checking for updates…",
		);
		expect(updateStatusText({ ...idle, state: "downloading", version: "1.0.9" }, "stable")).toBe(
			"Downloading Yoqa v1.0.9…",
		);
		expect(updateStatusText({ ...idle, state: "ready", version: "1.0.9" }, "stable")).toBe(
			"Yoqa v1.0.9 is ready — restart to install it",
		);
	});

	test("names the Yoqa update that failed to install", () => {
		expect(
			updateStatusText({ ...idle, state: "error", version: "1.0.9", lastError: "x" }, "stable"),
		).toBe("Yoqa v1.0.9 couldn't be installed");
	});

	test("says the last check failed when it did", () => {
		expect(
			updateStatusText({ ...idle, lastCheckedAt: 1, lastError: "Failed to fetch" }, "stable"),
		).toBe("The last check for updates failed");
	});

	test("says development versions never check", () => {
		expect(updateStatusText(idle, "dev")).toBe("Development versions don't check for Yoqa updates");
	});

	test("says a prerelease never receives a Yoqa update, even after a failed check", () => {
		expect(updateStatusText({ ...idle, lastCheckedAt: 1, lastError: "404" }, "canary")).toBe(
			"This prerelease doesn't receive Yoqa updates",
		);
	});
});
