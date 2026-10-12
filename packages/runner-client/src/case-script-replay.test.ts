import { describe, expect, test } from "bun:test";
import {
	type CaseScriptReplayClient,
	type CaseScriptReplayEvent,
	caseScriptActionCommand,
	runCaseScript,
} from "./case-script-replay";
import type { ActionRequest, CaseScript, CaseScriptAction, ScreenElement } from "./schemas";

function element(label: string): ScreenElement {
	return { label, type: "Button", x: 0, y: 0, width: 10, height: 10 } as ScreenElement;
}

function fakeDevice(options: { screens?: string[][]; failOn?: ActionRequest["kind"] } = {}) {
	const requests: ActionRequest[] = [];
	const sleeps: number[] = [];
	let clock = 0;
	let screenReads = 0;
	const screens = options.screens ?? [[]];
	const client: CaseScriptReplayClient = {
		performAction: async (request) => {
			requests.push(request);
			if (request.kind === options.failOn) throw new Error(`${request.kind} failed`);
			return { ok: true } as never;
		},
		getScreen: async () => {
			const labels = screens[Math.min(screenReads, screens.length - 1)] ?? [];
			screenReads += 1;
			return { elements: labels.map(element) } as never;
		},
	};
	return {
		client,
		requests,
		sleeps,
		screenReads: () => screenReads,
		sleep: async (ms: number, signal?: AbortSignal) => {
			if (signal?.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
			sleeps.push(ms);
			clock += ms;
		},
		now: () => clock,
	};
}

function script(...actions: CaseScriptAction[]): CaseScript {
	return { version: 1, savedAt: 1, actions };
}

function collect() {
	const events: Array<Pick<CaseScriptReplayEvent, "index" | "status" | "error">> = [];
	return {
		events,
		onStep: (event: CaseScriptReplayEvent) => {
			events.push({
				index: event.index,
				status: event.status,
				...(event.error ? { error: event.error } : {}),
			});
		},
	};
}

describe("runCaseScript", () => {
	test("sends each device Action as its runner request", async () => {
		const device = fakeDevice();
		const result = await runCaseScript(
			device.client,
			script(
				{ type: "tap", label: "Home" },
				{ type: "tap", id: "submit", x: 1, y: 2, double: true, durationMs: 900 },
				{ type: "swipe", x: 500, y: 800, x2: 500, y2: 200, durationMs: 300 },
				{ type: "drag", x: 1, y: 2, x2: 3, y2: 4 },
				{ type: "type", text: "hello" },
				{ type: "alert", alertAction: "dismiss" },
				{ type: "restart-app", appId: "com.example" },
				{ type: "background-app", seconds: 2 },
				{ type: "open-url", url: "myapp://x" },
			),
			{ sleep: device.sleep, now: device.now },
		);
		expect(result).toEqual({ ok: true, completed: 9, total: 9 });
		expect(device.requests).toEqual([
			{ kind: "tap", label: "Home" },
			{ kind: "tap", id: "submit", x: 1, y: 2, double: true, durationMs: 900 },
			{ kind: "swipe", x: 500, y: 800, x2: 500, y2: 200, durationMs: 300 },
			{ kind: "drag", x: 1, y: 2, x2: 3, y2: 4 },
			{ kind: "input", text: "hello" },
			{ kind: "alert", alertAction: "dismiss" },
			{ kind: "restart-app", appId: "com.example" },
			{ kind: "background-app", seconds: 2 },
			{ kind: "open-url", url: "myapp://x" },
		]);
	});

	test("waits exactly the milliseconds in the Case Script", async () => {
		const device = fakeDevice();
		await runCaseScript(
			device.client,
			script({ type: "wait", ms: 50 }, { type: "wait", ms: 7_500 }),
			{
				sleep: device.sleep,
				now: device.now,
			},
		);
		expect(device.sleeps).toEqual([50, 7_500]);
		expect(device.requests).toEqual([]);
	});

	test("polls an assert until the text appears", async () => {
		const device = fakeDevice({ screens: [[], [], ["Welcome back"]] });
		const result = await runCaseScript(
			device.client,
			script({ type: "assert", assertion: "visible", text: "welcome" }),
			{ sleep: device.sleep, now: device.now, assertPollMs: 100 },
		);
		expect(result.ok).toBe(true);
		expect(device.screenReads()).toBe(3);
	});

	test("fails an assert after its timeout", async () => {
		const device = fakeDevice({ screens: [["Error"]] });
		const result = await runCaseScript(
			device.client,
			script({ type: "assert", assertion: "not-visible", text: "Error", timeoutMs: 1_000 }),
			{ sleep: device.sleep, now: device.now, assertPollMs: 400 },
		);
		expect(result).toEqual({
			ok: false,
			completed: 0,
			total: 1,
			failedIndex: 0,
			error: "Unexpected text still visible after 1s: Error",
		});
	});

	test("stops at the first failure and reports the rest as skipped", async () => {
		const device = fakeDevice({ failOn: "swipe" });
		const steps = collect();
		const result = await runCaseScript(
			device.client,
			script(
				{ type: "tap", label: "A" },
				{ type: "swipe", x: 1, y: 2, x2: 3, y2: 4 },
				{ type: "tap", label: "B" },
				{ type: "wait", ms: 10 },
			),
			{ sleep: device.sleep, now: device.now, onStep: steps.onStep },
		);
		expect(result).toEqual({
			ok: false,
			completed: 1,
			total: 4,
			failedIndex: 1,
			error: "swipe failed",
		});
		expect(steps.events).toEqual([
			{ index: 0, status: "running" },
			{ index: 0, status: "ok" },
			{ index: 1, status: "running" },
			{ index: 1, status: "error", error: "swipe failed" },
			{ index: 2, status: "skipped" },
			{ index: 3, status: "skipped" },
		]);
		expect(device.requests.map((r) => r.label ?? r.kind)).toEqual(["A", "swipe"]);
	});

	test("an abort stops the replay and skips what is left", async () => {
		const device = fakeDevice();
		const aborter = new AbortController();
		const steps = collect();
		const result = await runCaseScript(
			device.client,
			script({ type: "tap", label: "A" }, { type: "tap", label: "B" }, { type: "tap", label: "C" }),
			{
				sleep: device.sleep,
				now: device.now,
				signal: aborter.signal,
				onStep: (event) => {
					steps.onStep(event);
					if (event.index === 0 && event.status === "ok") aborter.abort();
				},
			},
		);
		expect(result).toEqual({ ok: false, completed: 1, total: 3, failedIndex: 1, error: "Aborted" });
		expect(steps.events.slice(2)).toEqual([
			{ index: 1, status: "skipped" },
			{ index: 2, status: "skipped" },
		]);
		expect(device.requests).toHaveLength(1);
	});
});

describe("caseScriptActionCommand", () => {
	test("names the shell command each action replays as", () => {
		expect(caseScriptActionCommand({ type: "tap", label: "Home" })).toBe(
			"yoqa action tap --label 'Home'",
		);
		expect(caseScriptActionCommand({ type: "type", text: "hi" })).toBe(
			"yoqa action input --text 'hi'",
		);
		expect(caseScriptActionCommand({ type: "wait", ms: 1500 })).toBe("sleep 1.5");
		expect(
			caseScriptActionCommand({
				type: "assert",
				assertion: "visible",
				text: "it's",
				timeoutMs: 3000,
			}),
		).toBe("yoqa assert visible --text 'it'\\''s' --timeout 3");
	});
});
