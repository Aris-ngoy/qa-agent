import { describe, expect, test } from "bun:test";
import {
	type CaseScriptReplayClient,
	type CaseScriptReplayEvent,
	caseScriptActionCommand,
	formatCaseScriptReplayStep,
	formatCaseScriptStepPath,
	runCaseScript,
} from "./case-script-replay";
import type {
	ActionRequest,
	CaseScript,
	CaseScriptAction,
	CaseScriptBranch,
	ScreenElement,
} from "./schemas";

/** A Screen element from a label, or from `#id` for an element with that id and no label. */
function element(label: string): ScreenElement {
	const base = { type: "Button", x: 0, y: 0, width: 10, height: 10 };
	if (label.startsWith("#")) return { ...base, label: "", id: label.slice(1) } as ScreenElement;
	return { ...base, label } as ScreenElement;
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
				{ type: "key", key: "Tab", modifiers: ["Shift"] },
			),
			{ sleep: device.sleep, now: device.now },
		);
		expect(result).toEqual({ ok: true, completed: 10, total: 10 });
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
			{ kind: "key", key: "Tab", modifiers: ["Shift"] },
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
			failedPath: { index: 0, nested: [] },
			error: "Unexpected text still visible after 1s: Error",
		});
	});

	test("keeps polling an assert through failed screen reads", async () => {
		const device = fakeDevice({ screens: [[], ["Yoqa Demo"]] });
		let failures = 2;
		const flaky: CaseScriptReplayClient = {
			...device.client,
			getScreen: async () => {
				if (failures > 0) {
					failures -= 1;
					throw new Error("axbridge could not resolve the frontmost application");
				}
				return device.client.getScreen();
			},
		};
		const result = await runCaseScript(
			flaky,
			script({ type: "assert", assertion: "visible", text: "Yoqa Demo", timeoutMs: 5_000 }),
			{ sleep: device.sleep, now: device.now, assertPollMs: 100 },
		);
		expect(result.ok).toBe(true);
		expect(device.screenReads()).toBe(2);
	});

	test("fails an assert whose screen never reads, naming the read error", async () => {
		const device = fakeDevice();
		const result = await runCaseScript(
			{ ...device.client, getScreen: async () => Promise.reject(new Error("no frontmost app")) },
			script({ type: "assert", assertion: "not-visible", text: "Error", timeoutMs: 1_000 }),
			{ sleep: device.sleep, now: device.now, assertPollMs: 400 },
		);
		expect(result.error).toBe("Could not read the screen within 1s: no frontmost app");
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
			failedPath: { index: 1, nested: [] },
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
		expect(result).toEqual({
			ok: false,
			completed: 1,
			total: 3,
			failedIndex: 1,
			failedPath: { index: 1, nested: [] },
			error: "Aborted",
		});
		expect(steps.events.slice(2)).toEqual([
			{ index: 1, status: "skipped" },
			{ index: 2, status: "skipped" },
		]);
		expect(device.requests).toHaveLength(1);
	});
});

describe("a Branch in client-side replay", () => {
	const allow = (extra: Partial<CaseScriptBranch> = {}): CaseScriptBranch => ({
		type: "branch",
		text: "Allow",
		assertion: "visible",
		then: [{ type: "tap", label: "Allow" }],
		...extra,
	});

	/** Each event as `status position/total path label`, e.g. `ok 2/4 1.then.0 Allow`. */
	function trace() {
		const lines: string[] = [];
		return {
			lines,
			onStep: (event: CaseScriptReplayEvent) => {
				const path = [
					event.path.index,
					...event.path.nested.flatMap((step) => [step.side, step.index]),
				].join(".");
				const what =
					event.action.type === "branch"
						? `if ${event.action.id != null ? `id ${event.action.id}` : event.action.text}${event.outcome ? ` → ${event.outcome}` : ""}`
						: event.action.type === "tap"
							? event.action.label
							: event.action.type;
				expect(event.index).toBe(event.path.index);
				lines.push(`${event.status} ${event.position + 1}/${event.total} ${path} ${what}`);
			},
		};
	}

	test("runs `then` in place when the text is on the Screen", async () => {
		const device = fakeDevice({ screens: [["Allow"]] });
		const steps = trace();
		const result = await runCaseScript(
			device.client,
			script({ type: "tap", label: "A" }, allow(), { type: "tap", label: "B" }),
			{ sleep: device.sleep, now: device.now, onStep: steps.onStep },
		);
		expect(result).toEqual({ ok: true, completed: 4, total: 4 });
		expect(device.requests.map((r) => r.label)).toEqual(["A", "Allow", "B"]);
		expect(steps.lines).toEqual([
			"running 1/3 0 A",
			"ok 1/3 0 A",
			"running 2/3 1 if Allow",
			"ok 2/4 1 if Allow → then",
			"running 3/4 1.then.0 Allow",
			"ok 3/4 1.then.0 Allow",
			"running 4/4 2 B",
			"ok 4/4 2 B",
		]);
	});

	test("runs `else` once the default 2s pass without the text, never reporting `then`", async () => {
		const device = fakeDevice({ screens: [["Home"]] });
		const steps = trace();
		const result = await runCaseScript(
			device.client,
			script(allow({ else: [{ type: "tap", label: "Later" }] })),
			{ sleep: device.sleep, now: device.now, assertPollMs: 500, onStep: steps.onStep },
		);
		expect(result).toEqual({ ok: true, completed: 2, total: 2 });
		expect(device.now()).toBe(2_000);
		expect(device.requests.map((r) => r.label)).toEqual(["Later"]);
		expect(steps.lines).toEqual([
			"running 1/1 0 if Allow",
			"ok 1/2 0 if Allow → else",
			"running 2/2 0.else.0 Later",
			"ok 2/2 0.else.0 Later",
		]);
	});

	test("waits for text that shows up a moment late, then takes `then`", async () => {
		const device = fakeDevice({ screens: [[], [], ["Allow"]] });
		const result = await runCaseScript(device.client, script(allow()), {
			sleep: device.sleep,
			now: device.now,
			assertPollMs: 100,
		});
		expect(result.ok).toBe(true);
		expect(device.screenReads()).toBe(3);
		expect(device.requests.map((r) => r.label)).toEqual(["Allow"]);
	});

	test("goes on to the next step when the text is missing and there is no `else`", async () => {
		const device = fakeDevice({ screens: [[]] });
		const result = await runCaseScript(
			device.client,
			script(allow({ timeoutMs: 0 }), { type: "tap", label: "B" }),
			{ sleep: device.sleep, now: device.now },
		);
		expect(result).toEqual({ ok: true, completed: 2, total: 2 });
		expect(device.requests.map((r) => r.label)).toEqual(["B"]);
	});

	test("takes `then` for not-visible text that is gone", async () => {
		const device = fakeDevice({ screens: [["Home"]] });
		await runCaseScript(
			device.client,
			script(allow({ text: "Loading", assertion: "not-visible" })),
			{
				sleep: device.sleep,
				now: device.now,
			},
		);
		expect(device.requests.map((r) => r.label)).toEqual(["Allow"]);
	});

	test("waits the default Branch timeout option when the Branch has no timeoutMs", async () => {
		const device = fakeDevice({ screens: [[]] });
		await runCaseScript(device.client, script(allow()), {
			sleep: device.sleep,
			now: device.now,
			assertPollMs: 100,
			defaultBranchTimeoutMs: 300,
			defaultAssertTimeoutMs: 10_000,
		});
		expect(device.now()).toBe(300);
	});

	test("follows a Branch nested in a side, with the path down to each step", async () => {
		const device = fakeDevice({ screens: [["Allow"]] });
		const steps = trace();
		const result = await runCaseScript(
			device.client,
			script(
				allow({
					then: [
						{ type: "tap", label: "Allow" },
						allow({ text: "Rate us", timeoutMs: 0, else: [{ type: "tap", label: "Done" }] }),
					],
				}),
			),
			{ sleep: device.sleep, now: device.now, onStep: steps.onStep },
		);
		expect(result).toEqual({ ok: true, completed: 4, total: 4 });
		expect(device.requests.map((r) => r.label)).toEqual(["Allow", "Done"]);
		expect(steps.lines.filter((line) => line.startsWith("ok"))).toEqual([
			"ok 1/3 0 if Allow → then",
			"ok 2/3 0.then.0 Allow",
			"ok 3/4 0.then.1 if Rate us → else",
			"ok 4/4 0.then.1.else.0 Done",
		]);
	});

	test("a failure inside a side fails the replay and skips the rest of the side and script", async () => {
		const device = fakeDevice({ screens: [["Allow"]], failOn: "swipe" });
		const steps = trace();
		const result = await runCaseScript(
			device.client,
			script(
				allow({
					then: [
						{ type: "swipe", x: 1, y: 2, x2: 3, y2: 4 },
						{ type: "tap", label: "Allow" },
					],
					else: [{ type: "tap", label: "Never" }],
				}),
				allow({ text: "Later" }),
				{ type: "tap", label: "B" },
			),
			{ sleep: device.sleep, now: device.now, onStep: steps.onStep },
		);
		expect(result).toEqual({
			ok: false,
			completed: 1,
			total: 5,
			failedIndex: 0,
			failedPath: { index: 0, nested: [{ side: "then", index: 0 }] },
			error: "swipe failed",
		});
		expect(steps.lines.slice(2)).toEqual([
			"running 2/5 0.then.0 swipe",
			"error 2/5 0.then.0 swipe",
			"skipped 3/5 0.then.1 Allow",
			"skipped 4/5 1 if Later",
			"skipped 5/5 2 B",
		]);
		expect(device.requests.map((r) => r.label ?? r.kind)).toEqual(["swipe"]);
	});

	test("fails with the read error when the Screen is still unreadable at the deadline", async () => {
		const device = fakeDevice();
		const steps = trace();
		const result = await runCaseScript(
			{ ...device.client, getScreen: async () => Promise.reject(new Error("no frontmost app")) },
			script(allow({ timeoutMs: 1_000, else: [{ type: "tap", label: "Later" }] })),
			{ sleep: device.sleep, now: device.now, onStep: steps.onStep },
		);
		expect(result).toMatchObject({
			ok: false,
			failedPath: { index: 0, nested: [] },
			error: "Could not read the screen within 1s: no frontmost app",
		});
		expect(steps.lines).toEqual(["running 1/1 0 if Allow", "error 1/1 0 if Allow"]);
		expect(device.requests).toEqual([]);
	});

	test("an abort while the Branch checks stops the replay", async () => {
		const device = fakeDevice({ screens: [[]] });
		const aborter = new AbortController();
		const result = await runCaseScript(
			{
				...device.client,
				getScreen: async () => {
					aborter.abort();
					return device.client.getScreen();
				},
			},
			script(allow({ else: [{ type: "tap", label: "Later" }] }), { type: "tap", label: "B" }),
			{ sleep: device.sleep, now: device.now, signal: aborter.signal },
		);
		expect(result).toMatchObject({ ok: false, completed: 0, failedIndex: 0, error: "Aborted" });
		expect(device.requests).toEqual([]);
	});

	test("an abort between the steps of a side skips what is left", async () => {
		const device = fakeDevice({ screens: [["Allow"]] });
		const aborter = new AbortController();
		const steps = trace();
		const result = await runCaseScript(
			device.client,
			script(
				allow({
					then: [
						{ type: "tap", label: "Allow" },
						{ type: "tap", label: "Next" },
					],
				}),
				{ type: "tap", label: "B" },
			),
			{
				sleep: device.sleep,
				now: device.now,
				signal: aborter.signal,
				onStep: (event) => {
					steps.onStep(event);
					if (event.action.type === "tap" && event.status === "ok") aborter.abort();
				},
			},
		);
		expect(result).toEqual({
			ok: false,
			completed: 2,
			total: 4,
			failedIndex: 0,
			failedPath: { index: 0, nested: [{ side: "then", index: 1 }] },
			error: "Aborted",
		});
		expect(steps.lines.slice(-2)).toEqual(["skipped 3/4 0.then.1 Next", "skipped 4/4 1 B"]);
		expect(device.requests.map((r) => r.label)).toEqual(["Allow"]);
	});

	test("takes `then` or `else` on an id, matched like a tap by id", async () => {
		const run = async (branch: CaseScriptBranch, screen: string[]) => {
			const device = fakeDevice({ screens: [screen] });
			const steps = trace();
			const result = await runCaseScript(device.client, script(branch), {
				sleep: device.sleep,
				now: device.now,
				onStep: steps.onStep,
			});
			return { result, taps: device.requests.map((r) => r.label), lines: steps.lines };
		};
		const skip = (extra: Partial<CaseScriptBranch> = {}) =>
			allow({
				text: undefined,
				id: "Onboarding-Skip",
				else: [{ type: "tap", label: "Later" }],
				...extra,
			});

		const seen = await run(skip(), ["#onboarding-skip"]);
		expect(seen.result).toEqual({ ok: true, completed: 2, total: 2 });
		expect(seen.taps).toEqual(["Allow"]);
		expect(seen.lines[1]).toBe("ok 1/2 0 if id Onboarding-Skip → then");

		// A label holding the id's text is not the id.
		expect((await run(skip(), ["Onboarding-Skip"])).taps).toEqual(["Later"]);
		expect((await run(skip({ assertion: "not-visible" }), ["Home"])).taps).toEqual(["Allow"]);
		expect((await run(skip({ assertion: "not-visible" }), ["#onboarding-skip"])).taps).toEqual([
			"Later",
		]);
	});

	test("names an id Branch by its id in its command and log line", () => {
		const branch: CaseScriptBranch = {
			type: "branch",
			id: "it's-skip",
			assertion: "visible",
			timeoutMs: 3_000,
			then: [{ type: "tap", id: "it's-skip" }],
		};
		expect(caseScriptActionCommand(branch)).toBe(
			"yoqa assert visible --id 'it'\\''s-skip' --timeout 3",
		);
		expect(
			formatCaseScriptReplayStep({
				action: branch,
				path: { index: 0, nested: [] },
				outcome: "else",
			}),
		).toBe("if visible id: it's-skip → else");
	});

	test("names the check a Branch makes as its command", () => {
		expect(
			caseScriptActionCommand({
				type: "branch",
				text: "Allow",
				assertion: "not-visible",
				then: [{ type: "tap", label: "Allow" }],
			}),
		).toBe("yoqa assert not-visible --text 'Allow' --timeout 2");
		expect(
			caseScriptActionCommand({
				type: "branch",
				text: "Allow",
				assertion: "visible",
				timeoutMs: 500,
				then: [{ type: "tap", label: "Allow" }],
			}),
		).toBe("yoqa assert visible --text 'Allow' --timeout 0.5");
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

describe("formatCaseScriptStepPath", () => {
	test("names a step 1-based, the way Case Script file errors do", () => {
		expect(formatCaseScriptStepPath({ index: 2, nested: [] })).toBe("action 3");
		expect(
			formatCaseScriptStepPath({
				index: 5,
				nested: [
					{ side: "then", index: 1 },
					{ side: "else", index: 0 },
				],
			}),
		).toBe("action 6 → then → action 2 → else → action 1");
	});
});

describe("formatCaseScriptReplayStep", () => {
	test("names a Branch by its check and outcome, and indents the steps of a side", () => {
		const branch: CaseScriptAction = {
			type: "branch",
			text: "Allow",
			assertion: "visible",
			then: [{ type: "tap", label: "Allow" }],
		};
		expect(formatCaseScriptReplayStep({ action: branch, path: { index: 0, nested: [] } })).toBe(
			"if visible: Allow",
		);
		expect(
			formatCaseScriptReplayStep({
				action: branch,
				path: { index: 0, nested: [{ side: "else", index: 0 }] },
				outcome: "then",
			}),
		).toBe("  if visible: Allow → then");
		expect(
			formatCaseScriptReplayStep({
				action: { type: "tap", label: "Allow" },
				path: { index: 0, nested: [{ side: "then", index: 0 }] },
			}),
		).toBe("  tap: Allow");
	});
});
