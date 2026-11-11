import { formatCaseScriptFileAction } from "./case-script-file";
import {
	type ActionRequest,
	type ActionResponse,
	BRANCH_DEFAULT_TIMEOUT_MS,
	type CaseScript,
	type CaseScriptAction,
	type ScreenElement,
	type ScreenResponse,
} from "./schemas";
import { checkScreen, describeScreenCheck, screenCheckMissMessage } from "./screen-check";
import { assertTargetFlags, formatActionShellLine } from "./shell-script";

/**
 * What a Case Script replay runs against: one adapter per place it runs (the Case executor in
 * a Run, `runCaseScript` for the CLI and the Inspector). The walker owns the order of steps,
 * Branches, waits, asserts and abort; everything around a step (a Settle after an Action, a
 * screenshot, a Run step) belongs to the adapter.
 */
export type CaseScriptReplayPort = {
	/** Perform one device Action. Whatever follows it (a Settle, a pause) belongs in here. */
	performAction: (request: ActionRequest) => Promise<ActionResponse | undefined>;
	/** One read of the cleaned Screen, for an assert or a Branch. */
	readScreen: () => Promise<{ elements?: ScreenElement[] }>;
	clock: {
		/** A `wait` step, and the gap between Screen reads. May reject on abort. */
		sleep: (ms: number) => Promise<void>;
		now: () => number;
	};
	isAborted: () => boolean;
	/** A Screen read error that ends the replay at once instead of meaning "not there yet". */
	isDeadSession?: (error: unknown) => boolean;
	/**
	 * The step sink: `running` before a step, then `ok` or `error`; after a failure, every step
	 * not reached is `skipped`. A throw from the sink on `running` or `ok` fails that step.
	 */
	onStep?: (event: CaseScriptReplayEvent) => void | Promise<void>;
};

/** The runner calls a client-side Case Script replay needs (a `RunnerClient` satisfies it). */
export type CaseScriptReplayClient = {
	performAction: (request: ActionRequest) => Promise<ActionResponse>;
	getScreen: (options?: { full?: boolean; pauseMjpeg?: boolean }) => Promise<ScreenResponse>;
};

export type CaseScriptReplayStatus = "running" | "ok" | "error" | "skipped";

/** The side of a Branch that ran: `then` when its check was met, `else` when not. */
export type CaseScriptBranchOutcome = "then" | "else";

/** One step into a Branch: its side and the 0-based position of a step there. */
export type CaseScriptStepNesting = { side: CaseScriptBranchOutcome; index: number };

/** Where a step sits: its 0-based top-level position and, inside Branches, the path down to it. */
export type CaseScriptStepPath = { index: number; nested: CaseScriptStepNesting[] };

export type CaseScriptReplayEvent = {
	/** 0-based position in `script.actions` (of the enclosing top-level step, inside a Branch). */
	index: number;
	path: CaseScriptStepPath;
	/** 0-based position of this step in the replay, out of `total`. */
	position: number;
	/** Steps run so far plus those still to come; grows when a Branch picks its side. */
	total: number;
	action: CaseScriptAction;
	status: CaseScriptReplayStatus;
	error?: string;
	/** The runner's answer for a device Action that finished ok. */
	response?: ActionResponse;
	/** The side a Branch that finished ok runs next. */
	outcome?: CaseScriptBranchOutcome;
};

export type CaseScriptReplayResult = {
	ok: boolean;
	/** Steps (Actions and Branches) that finished ok. */
	completed: number;
	/** Steps run plus those left; the side a Branch did not take is not counted. */
	total: number;
	/** 0-based top-level index of the step that failed, or where an abort stopped the replay. */
	failedIndex?: number;
	/** The full path of that step, inside Branches. */
	failedPath?: CaseScriptStepPath;
	/** The failure, or `Aborted`. */
	error?: string;
};

export type RunCaseScriptOptions = {
	signal?: AbortSignal;
	onStep?: (event: CaseScriptReplayEvent) => void | Promise<void>;
	/** Pause after each device Action before the next one (ms). Default 0. */
	pauseAfterActionMs?: number;
	/** Injected for tests; defaults to real time. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
};

export type RunCaseScriptResult = CaseScriptReplayResult;

/** How long an `assert` with no `timeoutMs` waits. */
export const DEFAULT_ASSERT_TIMEOUT_MS = 5_000;

/** How long an `assert` or a Branch checks the Screen: its own `timeoutMs`, or the default. */
export function caseScriptCheckTimeoutMs(
	action: Extract<CaseScriptAction, { type: "assert" | "branch" }>,
): number {
	return (
		action.timeoutMs ??
		(action.type === "branch" ? BRANCH_DEFAULT_TIMEOUT_MS : DEFAULT_ASSERT_TIMEOUT_MS)
	);
}

function abortError(): Error {
	return Object.assign(new Error("Aborted"), { name: "AbortError" });
}

function realSleep(ms: number, signal?: AbortSignal): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError());
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortError());
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * The device request behind a Case Script action, or `null` for `wait` / `assert` / a Branch
 * (which are not device Actions).
 */
export function caseScriptActionRequest(action: CaseScriptAction): ActionRequest | null {
	switch (action.type) {
		case "tap": {
			const request: ActionRequest = { kind: "tap" };
			if (action.label) request.label = action.label;
			if (action.id) request.id = action.id;
			if (action.x != null) request.x = action.x;
			if (action.y != null) request.y = action.y;
			if (action.double) request.double = true;
			if (action.durationMs != null) request.durationMs = action.durationMs;
			return request;
		}
		case "swipe":
		case "drag":
			return {
				kind: action.type,
				x: action.x,
				y: action.y,
				x2: action.x2,
				y2: action.y2,
				...(action.durationMs != null ? { durationMs: action.durationMs } : {}),
			};
		case "type":
			return { kind: "input", text: action.text };
		case "alert":
			return { kind: "alert", alertAction: action.alertAction };
		case "activate-app":
		case "terminate-app":
		case "restart-app":
			return { kind: action.type, appId: action.appId };
		case "background-app":
			return {
				kind: "background-app",
				...(action.seconds != null ? { seconds: action.seconds } : {}),
			};
		case "open-url":
			return { kind: "open-url", url: action.url };
		case "key":
			return {
				kind: "key",
				key: action.key,
				...(action.modifiers?.length ? { modifiers: action.modifiers } : {}),
			};
		case "wait":
		case "assert":
		case "branch":
			return null;
	}
}

/**
 * The `--timeout` of the `yoqa assert` line for an assert or a Branch. A Branch checks the
 * Screen the way an assert does, with its own default wait, kept exact: rounded up, the
 * check could see a target the Branch would miss and take the other side.
 */
function screenCheckTimeoutSeconds(
	action: Extract<CaseScriptAction, { type: "assert" | "branch" }>,
): number | undefined {
	if (action.type === "branch") return caseScriptCheckTimeoutMs(action) / 1000;
	if (action.timeoutMs == null) return undefined;
	return Math.max(1, Math.round(action.timeoutMs / 1000));
}

/** The `yoqa` shell command a Case Script action replays as (for logs and reports). */
export function caseScriptActionCommand(action: CaseScriptAction): string {
	if (action.type === "wait") {
		const seconds = action.ms / 1000;
		return `sleep ${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(3))}`;
	}
	if (action.type === "assert" || action.type === "branch") {
		const timeoutSeconds = screenCheckTimeoutSeconds(action);
		const timeout = timeoutSeconds != null ? ` --timeout ${timeoutSeconds}` : "";
		return ["yoqa", "assert", action.assertion, ...assertTargetFlags(action)].join(" ") + timeout;
	}
	const request = caseScriptActionRequest(action);
	return request ? formatActionShellLine(request) : action.type;
}

/** `action 2 → then → action 1`: a step's 1-based position, as Case Script file errors name it. */
export function formatCaseScriptStepPath(path: CaseScriptStepPath): string {
	return [
		`action ${path.index + 1}`,
		...path.nested.map((step) => `${step.side} → action ${step.index + 1}`),
	].join(" → ");
}

/**
 * One replay step for a log line: the Case Script file form of an Action, or `if visible: Allow`
 * / `if visible id: skip` (plus `→ then` once decided) for a Branch, indented two spaces per
 * Branch it sits in.
 */
export function formatCaseScriptReplayStep(
	event: Pick<CaseScriptReplayEvent, "action" | "path" | "outcome">,
): string {
	const { action } = event;
	const line =
		action.type === "branch"
			? `if ${describeScreenCheck(action)}${event.outcome ? ` → ${event.outcome}` : ""}`
			: formatCaseScriptFileAction(action);
	return `${"  ".repeat(event.path.nested.length)}${line}`;
}

type BranchSide = { outcome: CaseScriptBranchOutcome; actions: CaseScriptAction[] };

/**
 * Replay a Case Script step by step, without any decide, against one adapter's port.
 * A Branch checks the Screen and replays its chosen side in place; the other side is never
 * reported. A `wait` sleeps exactly its `ms`. Stops at the first failing step (or on abort)
 * and reports every later step as skipped.
 */
export async function replayCaseScript(
	script: CaseScript,
	port: CaseScriptReplayPort,
): Promise<CaseScriptReplayResult> {
	const { clock } = port;
	let total = script.actions.length;
	let completed = 0;
	let position = 0;

	const errorMessage = (error: unknown): string => {
		if (port.isAborted() || (error instanceof Error && error.name === "AbortError")) {
			return "Aborted";
		}
		return error instanceof Error ? error.message : String(error);
	};

	const check = (action: Extract<CaseScriptAction, { type: "assert" | "branch" }>) =>
		checkScreen({
			readScreen: port.readScreen,
			text: action.text,
			id: action.type === "branch" ? action.id : undefined,
			assertion: action.assertion,
			timeoutMs: caseScriptCheckTimeoutMs(action),
			sleep: clock.sleep,
			now: clock.now,
			isAborted: port.isAborted,
			isDeadSession: port.isDeadSession,
		});

	/** Run one step. A Branch returns the side it picked. */
	const runStep = async (
		action: CaseScriptAction,
	): Promise<{ response?: ActionResponse; side?: BranchSide }> => {
		switch (action.type) {
			case "wait":
				await clock.sleep(action.ms);
				return {};
			case "assert": {
				const { met } = await check(action);
				if (!met) {
					const timeoutMs = caseScriptCheckTimeoutMs(action);
					throw new Error(screenCheckMissMessage({ ...action, timeoutMs }));
				}
				return {};
			}
			case "branch": {
				const { met } = await check(action);
				const outcome = met ? "then" : "else";
				return { side: { outcome, actions: (met ? action.then : action.else) ?? [] } };
			}
			default: {
				const request = caseScriptActionRequest(action);
				const response = request ? await port.performAction(request) : undefined;
				return response ? { response } : {};
			}
		}
	};

	type At = (index: number) => CaseScriptStepPath;
	type Failure = { path: CaseScriptStepPath; error: string };

	const emit = (
		path: CaseScriptStepPath,
		stepPosition: number,
		action: CaseScriptAction,
		status: CaseScriptReplayStatus,
		extra: Pick<CaseScriptReplayEvent, "error" | "response" | "outcome"> = {},
	) =>
		port.onStep?.({
			index: path.index,
			path,
			position: stepPosition,
			total,
			action,
			status,
			...extra,
		});

	const skipFrom = async (actions: CaseScriptAction[], from: number, at: At) => {
		for (let index = from; index < actions.length; index++) {
			const action = actions[index];
			if (action) await emit(at(index), position++, action, "skipped");
		}
	};

	/** Replay one list of steps; on a failure, skips the rest of it and returns where it failed. */
	const replay = async (actions: CaseScriptAction[], at: At): Promise<Failure | null> => {
		for (let index = 0; index < actions.length; index++) {
			const action = actions[index];
			if (!action) continue;
			const path = at(index);
			if (port.isAborted()) {
				await skipFrom(actions, index, at);
				return { path, error: "Aborted" };
			}
			const step = position++;
			let side: BranchSide | undefined;
			try {
				await emit(path, step, action, "running");
				// The sink may take its time (a Run takes a screenshot): never start a step after an abort.
				if (port.isAborted()) throw abortError();
				const done = await runStep(action);
				side = done.side;
				if (side) total += side.actions.length;
				completed += 1;
				await emit(path, step, action, "ok", {
					...(done.response ? { response: done.response } : {}),
					...(side ? { outcome: side.outcome } : {}),
				});
			} catch (error) {
				const message = errorMessage(error);
				await emit(path, step, action, "error", { error: message });
				await skipFrom(actions, index + 1, at);
				return { path, error: message };
			}
			if (side) {
				const outcome = side.outcome;
				const failure = await replay(side.actions, (inner) => ({
					index: path.index,
					nested: [...path.nested, { side: outcome, index: inner }],
				}));
				if (failure) {
					await skipFrom(actions, index + 1, at);
					return failure;
				}
			}
		}
		return null;
	};

	const failure = await replay(script.actions, (index) => ({ index, nested: [] }));
	if (failure) {
		return {
			ok: false,
			completed,
			total,
			failedIndex: failure.path.index,
			failedPath: failure.path,
			error: failure.error,
		};
	}
	return { ok: true, completed, total };
}

/**
 * Replay a Case Script on the Active Session through the runner's API (the CLI's `script run`
 * and the Inspector): `replayCaseScript` with a `RunnerClient` as its port.
 */
export function runCaseScript(
	client: CaseScriptReplayClient,
	script: CaseScript,
	options: RunCaseScriptOptions = {},
): Promise<RunCaseScriptResult> {
	const sleep = options.sleep ?? realSleep;
	const { signal, pauseAfterActionMs } = options;
	return replayCaseScript(script, {
		performAction: async (request) => {
			const response = await client.performAction(request);
			if (pauseAfterActionMs) await sleep(pauseAfterActionMs, signal);
			return response;
		},
		readScreen: () => client.getScreen(),
		clock: { sleep: (ms) => sleep(ms, signal), now: options.now ?? Date.now },
		isAborted: () => signal?.aborted ?? false,
		onStep: options.onStep,
	});
}
