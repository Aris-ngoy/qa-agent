import { describe, expect, test } from "bun:test";
import {
	type CaseScriptReplayEvent,
	type CaseScriptReplayPort,
	caseScriptActionCommand,
	formatCaseScriptReplayStep,
	formatCaseScriptStepPath,
	replayCaseScript,
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

class DeadSession extends Error {}

/**
 * A fake port: a device that records requests, a Screen that is `screens[n]` on the n-th read
 * (the last one from then on), and a clock that only moves when the replay sleeps.
 */
function fakePort(
	options: {
		screens?: string[][];
		failOn?: ActionRequest["kind"];
		readScreen?: () => Promise<{ elements?: ScreenElement[] }>;
		onStep?: (event: CaseScriptReplayEvent, port: { abort: () => void }) => void;
	} = {},
) {
	const requests: ActionRequest[] = [];
	const sleeps: number[] = [];
	let clock = 0;
	let screenReads = 0;
	let aborted = false;
	const screens = options.screens ?? [[]];
	const abort = () => {
		aborted = true;
	};
	const port: CaseScriptReplayPort = {
		performAction: async (request) => {
			requests.push(request);
			if (request.kind === options.failOn) throw new Error(`${request.kind} failed`);
			return { ok: true } as never;
		},
		readScreen:
			options.readScreen ??
			(async () => {
				const labels = screens[Math.min(screenReads, screens.length - 1)] ?? [];
				screenReads += 1;
				return { elements: labels.map(element) };
			}),
		clock: {
			sleep: async (ms) => {
				sleeps.push(ms);
				clock += ms;
			},
			now: () => clock,
		},
		isAborted: () => aborted,
		isDeadSession: (error) => error instanceof DeadSession,
		onStep: (event) => options.onStep?.(event, { abort }),
	};
	return {
		port,
		requests,
		sleeps,
		abort,
		screenReads: () => screenReads,
		now: () => clock,
	};
}

function script(...actions: CaseScriptAction[]): CaseScript {
	return { version: 1, savedAt: 1, actions };
}

/** Each event as `status position/total path label`, e.g. `ok 2/4 1.then.0 Allow`. */
function traceLine(event: CaseScriptReplayEvent): string {
	const path = [
		event.path.index,
		...event.path.nested.flatMap((step) => [step.side, step.index]),
	].join(".");
	const { action } = event;
	const what =
		action.type === "branch"
			? `if ${action.id != null ? `id ${action.id}` : action.text}${event.outcome ? ` → ${event.outcome}` : ""}`
			: action.type === "tap"
				? action.label
				: action.type;
	expect(event.index).toBe(event.path.index);
	return `${event.status} ${event.position + 1}/${event.total} ${path} ${what}`;
}

function traced(options: Parameters<typeof fakePort>[0] = {}) {
	const lines: string[] = [];
	const fake = fakePort({
		...options,
		onStep: (event, port) => {
			lines.push(traceLine(event));
			options.onStep?.(event, port);
		},
	});
	return { ...fake, lines };
}

describe("replayCaseScript", () => {
	test("sends each device Action as its runner request", async () => {
		const device = fakePort();
		const result = await replayCaseScript(
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
			device.port,
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
		// Nothing but `wait` and Screen checks sleeps: a Settle is the adapter's.
		expect(device.sleeps).toEqual([]);
	});

	test("waits exactly the milliseconds in the Case Script", async () => {
		const device = fakePort();
		await replayCaseScript(
			script({ type: "wait", ms: 0 }, { type: "wait", ms: 50 }, { type: "wait", ms: 7_500 }),
			device.port,
		);
		expect(device.sleeps).toEqual([0, 50, 7_500]);
		expect(device.requests).toEqual([]);
	});

	test("polls an assert until the text appears", async () => {
		const device = fakePort({ screens: [[], [], ["Welcome back"]] });
		const result = await replayCaseScript(
			script({ type: "assert", assertion: "visible", text: "welcome" }),
			device.port,
		);
		expect(result.ok).toBe(true);
		expect(device.screenReads()).toBe(3);
	});

	test("fails an assert after its timeout, 5s by default", async () => {
		const own = fakePort({ screens: [["Error"]] });
		expect(
			await replayCaseScript(
				script({ type: "assert", assertion: "not-visible", text: "Error", timeoutMs: 1_000 }),
				own.port,
			),
		).toEqual({
			ok: false,
			completed: 0,
			total: 1,
			failedIndex: 0,
			failedPath: { index: 0, nested: [] },
			error: "Unexpected text still visible after 1s: Error",
		});

		const byDefault = fakePort({ screens: [[]] });
		const result = await replayCaseScript(
			script({ type: "assert", assertion: "visible", text: "Home" }),
			byDefault.port,
		);
		expect(result.error).toBe("Expected visible text not found within 5s: Home");
		expect(byDefault.now()).toBe(5_200);
	});

	test("keeps polling an assert through failed screen reads", async () => {
		let failures = 2;
		const device = fakePort({
			readScreen: async () => {
				if (failures > 0) {
					failures -= 1;
					throw new Error("axbridge could not resolve the frontmost application");
				}
				return { elements: [element("Yoqa Demo")] };
			},
		});
		const result = await replayCaseScript(
			script({ type: "assert", assertion: "visible", text: "Yoqa Demo", timeoutMs: 5_000 }),
			device.port,
		);
		expect(result.ok).toBe(true);
		expect(device.now()).toBe(800);
	});

	test("fails an assert whose screen never reads, naming the read error", async () => {
		const device = fakePort({ readScreen: () => Promise.reject(new Error("no frontmost app")) });
		const result = await replayCaseScript(
			script({ type: "assert", assertion: "not-visible", text: "Error", timeoutMs: 1_000 }),
			device.port,
		);
		expect(result.error).toBe("Could not read the screen within 1s: no frontmost app");
	});

	test("ends a Screen check at once on a Dead Session", async () => {
		let reads = 0;
		const device = fakePort({
			readScreen: async () => {
				reads += 1;
				throw new DeadSession("Device session ended: simulator gone");
			},
		});
		const result = await replayCaseScript(
			script({ type: "assert", assertion: "visible", text: "Home" }),
			device.port,
		);
		expect(result.error).toBe("Device session ended: simulator gone");
		expect(reads).toBe(1);
		expect(device.now()).toBe(0);
	});

	test("stops at the first failure and reports the rest as skipped", async () => {
		const device = traced({ failOn: "swipe" });
		const result = await replayCaseScript(
			script(
				{ type: "tap", label: "A" },
				{ type: "swipe", x: 1, y: 2, x2: 3, y2: 4 },
				{ type: "tap", label: "B" },
				{ type: "wait", ms: 10 },
			),
			device.port,
		);
		expect(result).toEqual({
			ok: false,
			completed: 1,
			total: 4,
			failedIndex: 1,
			failedPath: { index: 1, nested: [] },
			error: "swipe failed",
		});
		expect(device.lines).toEqual([
			"running 1/4 0 A",
			"ok 1/4 0 A",
			"running 2/4 1 swipe",
			"error 2/4 1 swipe",
			"skipped 3/4 2 B",
			"skipped 4/4 3 wait",
		]);
		expect(device.requests.map((r) => r.label ?? r.kind)).toEqual(["A", "swipe"]);
	});

	test("a step the sink fails is a failed step", async () => {
		const device = traced({
			onStep: (event) => {
				if (event.status === "ok" && event.index === 0) throw new Error("could not save step");
			},
		});
		const result = await replayCaseScript(
			script({ type: "tap", label: "A" }, { type: "tap", label: "B" }),
			device.port,
		);
		expect(result).toMatchObject({ ok: false, failedIndex: 0, error: "could not save step" });
		expect(device.lines.slice(2)).toEqual(["error 1/2 0 A", "skipped 2/2 1 B"]);
	});

	test("an abort stops the replay and skips what is left", async () => {
		const device = traced({
			onStep: (event, port) => {
				if (event.index === 0 && event.status === "ok") port.abort();
			},
		});
		const result = await replayCaseScript(
			script({ type: "tap", label: "A" }, { type: "tap", label: "B" }, { type: "tap", label: "C" }),
			device.port,
		);
		expect(result).toEqual({
			ok: false,
			completed: 1,
			total: 3,
			failedIndex: 1,
			failedPath: { index: 1, nested: [] },
			error: "Aborted",
		});
		expect(device.lines.slice(2)).toEqual(["skipped 2/3 1 B", "skipped 3/3 2 C"]);
		expect(device.requests).toHaveLength(1);
	});

	test("an abort while a step is announced never starts it", async () => {
		const device = traced({
			onStep: (event, port) => {
				if (event.index === 1 && event.status === "running") port.abort();
			},
		});
		const result = await replayCaseScript(
			script({ type: "tap", label: "A" }, { type: "tap", label: "B" }),
			device.port,
		);
		expect(result).toMatchObject({ ok: false, failedIndex: 1, error: "Aborted" });
		expect(device.lines.slice(2)).toEqual(["running 2/2 1 B", "error 2/2 1 B"]);
		expect(device.requests.map((r) => r.label)).toEqual(["A"]);
	});
});

describe("a Branch in replay", () => {
	const allow = (extra: Partial<CaseScriptBranch> = {}): CaseScriptBranch => ({
		type: "branch",
		text: "Allow",
		assertion: "visible",
		then: [{ type: "tap", label: "Allow" }],
		...extra,
	});

	test("runs `then` in place when the text is on the Screen", async () => {
		const device = traced({ screens: [["Allow"]] });
		const result = await replayCaseScript(
			script({ type: "tap", label: "A" }, allow(), { type: "tap", label: "B" }),
			device.port,
		);
		expect(result).toEqual({ ok: true, completed: 4, total: 4 });
		expect(device.requests.map((r) => r.label)).toEqual(["A", "Allow", "B"]);
		expect(device.lines).toEqual([
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
		const device = traced({ screens: [["Home"]] });
		const result = await replayCaseScript(
			script(allow({ else: [{ type: "tap", label: "Later" }] })),
			device.port,
		);
		expect(result).toEqual({ ok: true, completed: 2, total: 2 });
		expect(device.now()).toBe(2_000);
		expect(device.requests.map((r) => r.label)).toEqual(["Later"]);
		expect(device.lines).toEqual([
			"running 1/1 0 if Allow",
			"ok 1/2 0 if Allow → else",
			"running 2/2 0.else.0 Later",
			"ok 2/2 0.else.0 Later",
		]);
	});

	test("waits the Branch's own timeoutMs", async () => {
		const device = fakePort({ screens: [[]] });
		await replayCaseScript(script(allow({ timeoutMs: 400 })), device.port);
		expect(device.now()).toBe(400);
	});

	test("waits for text that shows up a moment late, then takes `then`", async () => {
		const device = fakePort({ screens: [[], [], ["Allow"]] });
		const result = await replayCaseScript(script(allow()), device.port);
		expect(result.ok).toBe(true);
		expect(device.screenReads()).toBe(3);
		expect(device.requests.map((r) => r.label)).toEqual(["Allow"]);
	});

	test("goes on to the next step when the text is missing and there is no `else`", async () => {
		const device = fakePort({ screens: [[]] });
		const result = await replayCaseScript(
			script(allow({ timeoutMs: 0 }), { type: "tap", label: "B" }),
			device.port,
		);
		expect(result).toEqual({ ok: true, completed: 2, total: 2 });
		expect(device.requests.map((r) => r.label)).toEqual(["B"]);
	});

	test("checks not-visible", async () => {
		const gone = fakePort({ screens: [["Loading…"], ["Home"]] });
		await replayCaseScript(script(allow({ text: "Loading", assertion: "not-visible" })), gone.port);
		expect(gone.requests.map((r) => r.label)).toEqual(["Allow"]);
		expect(gone.now()).toBe(400);
	});

	test("follows a Branch nested in a side, with the path down to each step", async () => {
		const device = traced({ screens: [["Allow"]] });
		const result = await replayCaseScript(
			script(
				allow({
					then: [
						{ type: "tap", label: "Allow" },
						allow({ text: "Rate us", timeoutMs: 0, else: [{ type: "tap", label: "Done" }] }),
					],
				}),
			),
			device.port,
		);
		expect(result).toEqual({ ok: true, completed: 4, total: 4 });
		expect(device.requests.map((r) => r.label)).toEqual(["Allow", "Done"]);
		expect(device.lines.filter((line) => line.startsWith("ok"))).toEqual([
			"ok 1/3 0 if Allow → then",
			"ok 2/3 0.then.0 Allow",
			"ok 3/4 0.then.1 if Rate us → else",
			"ok 4/4 0.then.1.else.0 Done",
		]);
	});

	test("a failure inside a side fails the replay and skips the rest of the side and script", async () => {
		const device = traced({ screens: [["Allow"]], failOn: "swipe" });
		const result = await replayCaseScript(
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
			device.port,
		);
		expect(result).toEqual({
			ok: false,
			completed: 1,
			total: 5,
			failedIndex: 0,
			failedPath: { index: 0, nested: [{ side: "then", index: 0 }] },
			error: "swipe failed",
		});
		expect(device.lines.slice(2)).toEqual([
			"running 2/5 0.then.0 swipe",
			"error 2/5 0.then.0 swipe",
			"skipped 3/5 0.then.1 Allow",
			"skipped 4/5 1 if Later",
			"skipped 5/5 2 B",
		]);
		expect(device.requests.map((r) => r.label ?? r.kind)).toEqual(["swipe"]);
	});

	test("fails with the read error when the Screen is still unreadable at the deadline", async () => {
		const device = traced({ readScreen: () => Promise.reject(new Error("no frontmost app")) });
		const result = await replayCaseScript(
			script(allow({ timeoutMs: 1_000, else: [{ type: "tap", label: "Later" }] })),
			device.port,
		);
		expect(result).toMatchObject({
			ok: false,
			failedPath: { index: 0, nested: [] },
			error: "Could not read the screen within 1s: no frontmost app",
		});
		expect(device.lines).toEqual(["running 1/1 0 if Allow", "error 1/1 0 if Allow"]);
		expect(device.requests).toEqual([]);
	});

	test("an abort while the Branch checks stops the replay", async () => {
		const device = fakePort({ screens: [[]] });
		device.port.readScreen = async () => {
			device.abort();
			return { elements: [] };
		};
		const result = await replayCaseScript(
			script(allow({ else: [{ type: "tap", label: "Later" }] }), { type: "tap", label: "B" }),
			device.port,
		);
		expect(result).toMatchObject({ ok: false, completed: 0, failedIndex: 0, error: "Aborted" });
		expect(device.now()).toBe(400);
		expect(device.requests).toEqual([]);
	});

	test("an abort between the steps of a side skips what is left", async () => {
		const device = traced({
			screens: [["Allow"]],
			onStep: (event, port) => {
				if (event.action.type === "tap" && event.status === "ok") port.abort();
			},
		});
		const result = await replayCaseScript(
			script(
				allow({
					then: [
						{ type: "tap", label: "Allow" },
						{ type: "tap", label: "Next" },
					],
				}),
				{ type: "tap", label: "B" },
			),
			device.port,
		);
		expect(result).toEqual({
			ok: false,
			completed: 2,
			total: 4,
			failedIndex: 0,
			failedPath: { index: 0, nested: [{ side: "then", index: 1 }] },
			error: "Aborted",
		});
		expect(device.lines.slice(-2)).toEqual(["skipped 3/4 0.then.1 Next", "skipped 4/4 1 B"]);
		expect(device.requests.map((r) => r.label)).toEqual(["Allow"]);
	});

	test("takes `then` or `else` on an id, matched like a tap by id", async () => {
		const run = async (branch: CaseScriptBranch, screen: string[]) => {
			const device = traced({ screens: [screen] });
			const result = await replayCaseScript(script(branch), device.port);
			return { result, taps: device.requests.map((r) => r.label), lines: device.lines };
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

describe("runCaseScript (the RunnerClient adapter)", () => {
	function client(screen: string[] = []) {
		const requests: ActionRequest[] = [];
		return {
			requests,
			client: {
				performAction: async (request: ActionRequest) => {
					requests.push(request);
					return { ok: true } as never;
				},
				getScreen: async () => ({ elements: screen.map(element) }) as never,
			},
		};
	}

	test("pauses after each device Action and passes the runner's answer on", async () => {
		const device = client();
		const sleeps: number[] = [];
		const responses: unknown[] = [];
		const result = await runCaseScript(
			device.client,
			script({ type: "tap", label: "A" }, { type: "wait", ms: 30 }),
			{
				pauseAfterActionMs: 200,
				sleep: async (ms) => {
					sleeps.push(ms);
				},
				now: () => 0,
				onStep: (event) => {
					if (event.status === "ok" && event.response) responses.push(event.response);
				},
			},
		);
		expect(result).toEqual({ ok: true, completed: 2, total: 2 });
		expect(sleeps).toEqual([200, 30]);
		expect(responses).toEqual([{ ok: true }]);
	});

	test("an aborted signal stops the replay", async () => {
		const device = client();
		const aborter = new AbortController();
		const result = await runCaseScript(
			device.client,
			script({ type: "tap", label: "A" }, { type: "tap", label: "B" }),
			{
				signal: aborter.signal,
				sleep: async () => {},
				now: () => 0,
				onStep: (event) => {
					if (event.status === "ok") aborter.abort();
				},
			},
		);
		expect(result).toMatchObject({ ok: false, failedIndex: 1, error: "Aborted" });
		expect(device.requests).toHaveLength(1);
	});

	test("reads the Screen through the client for a Branch", async () => {
		const device = client(["Allow"]);
		const result = await runCaseScript(
			device.client,
			script({
				type: "branch",
				text: "Allow",
				assertion: "visible",
				then: [{ type: "tap", label: "Allow" }],
			}),
			{ sleep: async () => {}, now: () => 0 },
		);
		expect(result.ok).toBe(true);
		expect(device.requests).toEqual([{ kind: "tap", label: "Allow" }]);
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
