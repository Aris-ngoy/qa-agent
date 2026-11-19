import { describe, expect, test } from "bun:test";
import type { YoqaUpdateStatus } from "../../../shared/yoqa-update";
import {
	type YoqaUpdateCheck,
	type YoqaUpdateTimer,
	type YoqaUpdater,
	createYoqaUpdateController,
} from "./controller";

/** A timer whose clock only moves when a test calls `advance`. */
function fakeTimer() {
	let clock = 0;
	let nextId = 1;
	const pending = new Map<number, { at: number; callback: () => void }>();
	const timer: YoqaUpdateTimer = {
		setTimeout: (callback, ms) => {
			const id = nextId++;
			pending.set(id, { at: clock + ms, callback });
			return id;
		},
		clearTimeout: (handle) => {
			pending.delete(handle as number);
		},
	};
	return {
		timer,
		now: () => 1_700_000_000_000 + clock,
		/**
		 * Let pending work settle, move the clock forward, run every timer that came due, and
		 * let their promises settle.
		 */
		async advance(ms: number) {
			await settle();
			clock += ms;
			for (const [id, entry] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
				if (entry.at > clock) continue;
				pending.delete(id);
				entry.callback();
			}
			await settle();
		},
	};
}

async function settle() {
	for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** An `updater` that answers from a script and records every call. */
function fakeUpdater(script: {
	check?: () => Promise<YoqaUpdateCheck>;
	download?: () => Promise<void>;
	apply?: () => Promise<void>;
}) {
	const calls: string[] = [];
	const updater: YoqaUpdater = {
		check: async () => {
			calls.push("check");
			return script.check ? script.check() : { updateAvailable: false, version: "1.0.8" };
		},
		download: async () => {
			calls.push("download");
			return script.download?.();
		},
		apply: async () => {
			calls.push("apply");
			return script.apply?.();
		},
	};
	return { updater, calls };
}

const newer = (version: string): YoqaUpdateCheck => ({ updateAvailable: true, version });

const HOUR = 60 * 60 * 1000;

function setup(
	script: Parameters<typeof fakeUpdater>[0] = {},
	options: { channel?: string; autoCheck?: () => boolean | Promise<boolean> } = {},
) {
	const clock = fakeTimer();
	const { updater, calls } = fakeUpdater(script);
	const pushed: YoqaUpdateStatus[] = [];
	/** The local runner's answer to "is a Run in progress?"; a test flips it. */
	const runner: { runInProgress: boolean | Error } = { runInProgress: false };
	const controller = createYoqaUpdateController({
		updater,
		channel: options.channel ?? "stable",
		timer: clock.timer,
		now: clock.now,
		isRunInProgress: async () => {
			if (runner.runInProgress instanceof Error) throw runner.runInProgress;
			return runner.runInProgress;
		},
		readAutoCheck: options.autoCheck ?? (() => true),
		onStatus: (status) => pushed.push(status),
	});
	return {
		controller,
		calls,
		pushed,
		clock,
		runner,
		last: () => pushed.at(-1),
		states: () => pushed.map((status) => status.state),
	};
}

describe("Yoqa update controller", () => {
	test("checks for a Yoqa update shortly after launch", async () => {
		const { controller, calls, clock } = setup();
		controller.start();
		expect(calls).toEqual([]);
		await clock.advance(60_000);
		expect(calls).toEqual(["check"]);
	});

	test("checks again every 6 hours after the launch check", async () => {
		const { controller, calls, clock } = setup();
		controller.start();
		await clock.advance(60_000);
		expect(calls).toEqual(["check"]);
		await clock.advance(6 * HOUR - 60_000);
		expect(calls).toEqual(["check"]);
		await clock.advance(60_000);
		expect(calls).toEqual(["check", "check"]);
		await clock.advance(6 * HOUR);
		expect(calls).toEqual(["check", "check", "check"]);
	});

	test("makes no automatic checks when automatic checks are off", async () => {
		const { controller, calls, clock } = setup({}, { autoCheck: async () => false });
		controller.start();
		await clock.advance(24 * HOUR);
		expect(calls).toEqual([]);
		await controller.checkNow();
		expect(calls).toEqual(["check"]);
		await clock.advance(24 * HOUR);
		expect(calls).toEqual(["check"]);
	});

	test("turning automatic checks off cancels the next scheduled check", async () => {
		let autoCheck = true;
		const { controller, calls, clock } = setup({}, { autoCheck: () => autoCheck });
		controller.start();
		await clock.advance(60_000);
		expect(calls).toEqual(["check"]);
		autoCheck = false;
		await controller.autoCheckChanged();
		await clock.advance(24 * HOUR);
		expect(calls).toEqual(["check"]);
	});

	test("turning automatic checks on schedules a check without a relaunch", async () => {
		let autoCheck = false;
		const { controller, calls, clock } = setup({}, { autoCheck: () => autoCheck });
		controller.start();
		await clock.advance(HOUR);
		expect(calls).toEqual([]);
		autoCheck = true;
		await controller.autoCheckChanged();
		await clock.advance(60_000);
		expect(calls).toEqual(["check"]);
		await clock.advance(6 * HOUR);
		expect(calls).toEqual(["check", "check"]);
	});

	test("turning automatic checks on waits 6 hours from the last check", async () => {
		let autoCheck = false;
		const { controller, calls, clock } = setup({}, { autoCheck: () => autoCheck });
		controller.start();
		await controller.checkNow();
		await clock.advance(2 * HOUR);
		autoCheck = true;
		await controller.autoCheckChanged();
		await clock.advance(4 * HOUR - 1);
		expect(calls).toEqual(["check"]);
		await clock.advance(1);
		expect(calls).toEqual(["check", "check"]);
	});

	test("downloads a newer Yoqa update and reports it ready with its version", async () => {
		const { controller, calls, states, last } = setup({ check: async () => newer("1.0.9") });
		await controller.checkNow();
		expect(calls).toEqual(["check", "download"]);
		expect(states()).toEqual(["checking", "downloading", "ready"]);
		expect(last()).toMatchObject({ state: "ready", version: "1.0.9", lastError: null });
	});

	test("goes back to idle with the check time when Yoqa is up to date", async () => {
		const { controller, calls, last, clock } = setup();
		await clock.advance(42_000);
		await controller.checkNow();
		expect(calls).toEqual(["check"]);
		expect(last()).toEqual({
			state: "idle",
			version: null,
			lastCheckedAt: 1_700_000_042_000,
			lastError: null,
			restartHeld: false,
		});
	});

	test("records a failed check as the last error and goes back to idle", async () => {
		const { controller, last, clock } = setup({
			check: async () => {
				throw new Error("Failed to fetch update info");
			},
		});
		await clock.advance(5_000);
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "idle",
			version: null,
			lastCheckedAt: 1_700_000_005_000,
			lastError: "Failed to fetch update info",
		});
	});

	test("records a failed download as the last error and goes back to idle", async () => {
		const { controller, last } = setup({
			check: async () => newer("1.0.9"),
			download: async () => {
				throw new Error("Failed to download latest version");
			},
		});
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "idle",
			version: null,
			lastError: "Failed to download latest version",
		});
		expect(last()?.lastCheckedAt).not.toBeNull();
	});

	test("retries a failed check or download only at the next scheduled check", async () => {
		let attempt = 0;
		const { controller, calls, clock, last } = setup({
			check: async () => {
				attempt++;
				if (attempt === 1) throw new Error("Failed to fetch update info");
				return newer("1.0.9");
			},
			download: async () => {
				if (attempt === 2) throw new Error("Failed to download latest version");
			},
		});
		controller.start();
		await clock.advance(60_000);
		expect(calls).toEqual(["check"]);
		expect(last()?.lastError).toBe("Failed to fetch update info");
		await clock.advance(6 * HOUR - 60_000);
		expect(calls).toEqual(["check"]);
		await clock.advance(60_000);
		expect(calls).toEqual(["check", "check", "download"]);
		expect(last()?.lastError).toBe("Failed to download latest version");
		await clock.advance(6 * HOUR - 1);
		expect(calls).toEqual(["check", "check", "download"]);
		await clock.advance(1);
		expect(calls).toEqual(["check", "check", "download", "check", "download"]);
		expect(last()).toMatchObject({ state: "ready", version: "1.0.9", lastError: null });
	});

	test("keeps a ready Yoqa update when a later check fails", async () => {
		let online = true;
		const { controller, last } = setup({
			check: async () => {
				if (!online) throw new Error("Failed to fetch update info");
				return newer("1.0.9");
			},
		});
		await controller.checkNow();
		online = false;
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "ready",
			version: "1.0.9",
			lastError: "Failed to fetch update info",
		});
	});

	test("keeps a ready Yoqa update when downloading a newer one fails", async () => {
		let latest = "1.0.9";
		const { controller, last } = setup({
			check: async () => newer(latest),
			download: async () => {
				if (latest !== "1.0.9") throw new Error("Failed to download latest version");
			},
		});
		await controller.checkNow();
		latest = "1.0.10";
		await controller.checkNow();
		expect(last()).toMatchObject({
			state: "ready",
			version: "1.0.9",
			lastError: "Failed to download latest version",
		});
	});

	test("drops a ready Yoqa update once a check says Yoqa is up to date", async () => {
		let released = true;
		const { controller, last } = setup({
			check: async () => (released ? newer("1.0.9") : { updateAvailable: false, version: "1.0.8" }),
		});
		await controller.checkNow();
		released = false;
		await controller.checkNow();
		expect(last()).toMatchObject({ state: "idle", version: null, lastError: null });
	});

	test("restart applies a ready Yoqa update exactly once", async () => {
		const { controller, calls } = setup({
			check: async () => newer("1.0.9"),
			// A real apply quits Yoqa; this one never finishes, like the app going away.
			apply: () => new Promise(() => {}),
		});
		await controller.checkNow();
		void controller.restart();
		void controller.restart();
		await settle();
		expect(calls.filter((call) => call === "apply")).toHaveLength(1);
	});

	test("never applies a Yoqa update on its own", async () => {
		const { controller, calls, clock, last } = setup({ check: async () => newer("1.0.9") });
		controller.start();
		await clock.advance(7 * 24 * 60 * 60 * 1000);
		await controller.checkNow();
		expect(last()?.state).toBe("ready");
		expect(calls).not.toContain("apply");
	});

	test("restart does nothing until a Yoqa update is ready", async () => {
		const { controller, calls } = setup();
		await controller.restart();
		await controller.checkNow();
		await controller.restart();
		expect(calls).toEqual(["check"]);
	});

	test("records a failed apply as the last error and keeps the update ready to retry", async () => {
		let attempts = 0;
		const { controller, calls, last } = setup({
			check: async () => newer("1.0.9"),
			apply: async () => {
				attempts++;
				if (attempts === 1) throw new Error("Failed to replace app");
			},
		});
		await controller.checkNow();
		await controller.restart();
		expect(last()).toMatchObject({
			state: "ready",
			version: "1.0.9",
			lastError: "Failed to replace app",
		});
		await controller.restart();
		expect(calls.filter((call) => call === "apply")).toHaveLength(2);
	});

	test("never checks on Electrobun's dev channel", async () => {
		const { controller, calls, clock, pushed } = setup(
			{ check: async () => newer("1.0.9") },
			{ channel: "dev" },
		);
		controller.start();
		await controller.autoCheckChanged();
		await clock.advance(24 * 60 * 60 * 1000);
		await controller.checkNow();
		expect(calls).toEqual([]);
		expect(pushed).toEqual([]);
		expect(controller.status().state).toBe("idle");
	});

	test("a check pressed while one is running joins it instead of starting another", async () => {
		let finishDownload = () => {};
		const { controller, calls, last } = setup({
			check: async () => newer("1.0.9"),
			download: () =>
				new Promise<void>((resolve) => {
					finishDownload = resolve;
				}),
		});
		const first = controller.checkNow();
		const second = controller.checkNow();
		await settle();
		finishDownload();
		await Promise.all([first, second]);
		expect(calls).toEqual(["check", "download"]);
		expect(last()?.state).toBe("ready");
	});

	describe("while a Run is in progress", () => {
		const ready = { check: async () => newer("1.0.9") };

		test("restart does not apply and says the restart is held", async () => {
			const { controller, calls, runner, last } = setup(ready);
			await controller.checkNow();
			runner.runInProgress = true;
			await controller.restart();
			expect(calls).not.toContain("apply");
			expect(last()).toMatchObject({ state: "ready", version: "1.0.9", restartHeld: true });
		});

		test("the held restart clears soon after the Run ends, and restart then applies", async () => {
			const { controller, calls, runner, clock, last } = setup(ready);
			await controller.checkNow();
			runner.runInProgress = true;
			await controller.restart();
			runner.runInProgress = false;
			await clock.advance(10_000);
			expect(last()).toMatchObject({ state: "ready", restartHeld: false });
			expect(calls).not.toContain("apply");
			await controller.restart();
			expect(calls.filter((call) => call === "apply")).toHaveLength(1);
		});

		test("an update that becomes ready during a Run shows the restart held from the start", async () => {
			const { controller, runner, pushed } = setup(ready);
			runner.runInProgress = true;
			await controller.checkNow();
			expect(pushed.filter((status) => status.state === "ready")).toEqual([
				expect.objectContaining({ version: "1.0.9", restartHeld: true }),
			]);
		});

		test("a Run that starts while an update is ready holds the restart before it is pressed", async () => {
			const { controller, runner, clock, last } = setup(ready);
			await controller.checkNow();
			expect(last()?.restartHeld).toBe(false);
			runner.runInProgress = true;
			await clock.advance(10_000);
			expect(last()).toMatchObject({ state: "ready", restartHeld: true });
		});

		test("a runner that can't answer runs no Run, so it holds nothing", async () => {
			const { controller, calls, runner, clock, last } = setup(ready);
			runner.runInProgress = new Error("Runner unreachable");
			await controller.checkNow();
			await clock.advance(10_000);
			expect(last()).toMatchObject({ state: "ready", restartHeld: false, lastError: null });
			await controller.restart();
			expect(calls.filter((call) => call === "apply")).toHaveLength(1);
		});

		test("an update dropped while held is no longer held", async () => {
			let released = true;
			const { controller, runner, last } = setup({
				check: async () =>
					released ? newer("1.0.9") : { updateAvailable: false, version: "1.0.8" },
			});
			runner.runInProgress = true;
			await controller.checkNow();
			released = false;
			await controller.checkNow();
			expect(last()).toMatchObject({ state: "idle", version: null, restartHeld: false });
		});
	});
});
