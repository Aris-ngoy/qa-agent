import { formatCaseScriptFileAction } from "./case-script-file";
import {
	type ActionRequest,
	type ActionResponse,
	BRANCH_DEFAULT_TIMEOUT_MS,
	type CaseScript,
	type CaseScriptAction,
	type ScreenResponse,
} from "./schemas";
import {
	SCREEN_CHECK_POLL_MS,
	checkScreen,
	describeScreenCheck,
	screenCheckMissMessage,
} from "./screen-check";
import { assertTargetFlags, formatActionShellLine } from "./shell-script";

/** The runner calls a Case Script replay needs (a `RunnerClient` satisfies it). */
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

export type RunCaseScriptOptions = {
	signal?: AbortSignal;
	onStep?: (event: CaseScriptReplayEvent) => void | Promise<void>;
	/** Pause after each device Action before the next one (ms). Default 0. */
	pauseAfterActionMs?: number;
	/** How long an `assert` waits when the action has no `timeoutMs`. Default 5000. */
	defaultAssertTimeoutMs?: number;
	/** How long a Branch waits when it has no `timeoutMs`. Default 2000. */
	defaultBranchTimeoutMs?: number;
	/** Delay between `assert` and Branch screen reads. Default 400. */
	assertPollMs?: number;
	/** Injected for tests; defaults to real time. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
};

export type RunCaseScriptResult = {
	ok: boolean;
	/** Steps (Actions and Branches) that finished ok. */
	completed: number;
	/** Steps run plus those left; the side a Branch did not take is not counted. */
	total: number;
	/** 0-based top-level index of the step that failed, or where an abort stopped the replay. */
	failedIndex?: number;
	/** The full path of that step, inside Branches. */
	failedPath?: CaseScriptStepPath;
	error?: string;
};

export const DEFAULT_ASSERT_TIMEOUT_MS = 5_000;

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

/** The `yoqa` shell command a Case Script action replays as (for logs and reports). */
export function caseScriptActionCommand(action: CaseScriptAction): string {
	if (action.type === "wait") {
		const seconds = action.ms / 1000;
		return `sleep ${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(3))}`;
	}
	if (action.type === "assert" || action.type === "branch") {
		// A Branch checks the Screen the way an assert does, with its own default wait.
		const timeoutMs =
			action.type === "branch" ? (action.timeoutMs ?? BRANCH_DEFAULT_TIMEOUT_MS) : action.timeoutMs;
		const timeout =
			timeoutMs != null ? ` --timeout ${Math.max(1, Math.round(timeoutMs / 1000))}` : "";
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

function replayErrorMessage(error: unknown, signal?: AbortSignal): string {
	if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) return "Aborted";
	if (error instanceof Error) return error.message;
	return String(error);
}

/**
 * Replay a Case Script on the Active Session, step by step, without any decide.
 * A Branch checks the Screen and replays its chosen side in place; the other side is never
 * reported. Stops at the first failing step and reports every later step as skipped.
 */
export async function runCaseScript(
	client: CaseScriptReplayClient,
	script: CaseScript,
	options: RunCaseScriptOptions = {},
): Promise<RunCaseScriptResult> {
	const sleep = options.sleep ?? realSleep;
	const now = options.now ?? Date.now;
	const pollMs = options.assertPollMs ?? SCREEN_CHECK_POLL_MS;
	let total = script.actions.length;
	let completed = 0;
	let position = 0;

	const check = async (
		action: { text?: string; id?: string; assertion: "visible" | "not-visible" },
		timeoutMs: number,
	) =>
		checkScreen({
			readScreen: () => client.getScreen(),
			text: action.text,
			id: action.id,
			assertion: action.assertion,
			timeoutMs,
			pollMs,
			sleep: (ms) => sleep(ms, options.signal),
			now,
			isAborted: () => options.signal?.aborted ?? false,
		});

	const assertText = async (action: Extract<CaseScriptAction, { type: "assert" }>) => {
		const timeoutMs =
			action.timeoutMs ?? options.defaultAssertTimeoutMs ?? DEFAULT_ASSERT_TIMEOUT_MS;
		const { met } = await check(action, timeoutMs);
		if (!met) throw new Error(screenCheckMissMessage({ ...action, timeoutMs }));
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
		options.onStep?.({
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
			if (options.signal?.aborted) {
				await skipFrom(actions, index, at);
				return { path, error: "Aborted" };
			}
			const step = position++;
			await emit(path, step, action, "running");
			let side: { outcome: CaseScriptBranchOutcome; actions: CaseScriptAction[] } | null = null;
			try {
				let response: ActionResponse | undefined;
				if (action.type === "wait") {
					await sleep(action.ms, options.signal);
				} else if (action.type === "assert") {
					await assertText(action);
				} else if (action.type === "branch") {
					const timeoutMs =
						action.timeoutMs ?? options.defaultBranchTimeoutMs ?? BRANCH_DEFAULT_TIMEOUT_MS;
					const { met } = await check(action, timeoutMs);
					const outcome = met ? "then" : "else";
					side = { outcome, actions: (met ? action.then : action.else) ?? [] };
					total += side.actions.length;
				} else {
					const request = caseScriptActionRequest(action);
					if (request) response = await client.performAction(request);
					if (options.pauseAfterActionMs) await sleep(options.pauseAfterActionMs, options.signal);
				}
				completed += 1;
				await emit(path, step, action, "ok", {
					...(response ? { response } : {}),
					...(side ? { outcome: side.outcome } : {}),
				});
			} catch (error) {
				const message = replayErrorMessage(error, options.signal);
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
