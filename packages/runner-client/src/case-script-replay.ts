import type {
	ActionRequest,
	ActionResponse,
	CaseScript,
	CaseScriptAction,
	ScreenResponse,
} from "./schemas";
import { formatActionShellLine, screenHasText } from "./shell-script";

/** The runner calls a Case Script replay needs (a `RunnerClient` satisfies it). */
export type CaseScriptReplayClient = {
	performAction: (request: ActionRequest) => Promise<ActionResponse>;
	getScreen: (options?: { full?: boolean; pauseMjpeg?: boolean }) => Promise<ScreenResponse>;
};

export type CaseScriptReplayStatus = "running" | "ok" | "error" | "skipped";

export type CaseScriptReplayEvent = {
	/** 0-based position in `script.actions`. */
	index: number;
	total: number;
	action: CaseScriptAction;
	status: CaseScriptReplayStatus;
	error?: string;
	/** The runner's answer for a device Action that finished ok. */
	response?: ActionResponse;
};

export type RunCaseScriptOptions = {
	signal?: AbortSignal;
	onStep?: (event: CaseScriptReplayEvent) => void | Promise<void>;
	/** Pause after each device Action before the next one (ms). Default 0. */
	pauseAfterActionMs?: number;
	/** How long an `assert` waits when the action has no `timeoutMs`. Default 5000. */
	defaultAssertTimeoutMs?: number;
	/** Delay between `assert` screen reads. Default 400. */
	assertPollMs?: number;
	/** Injected for tests; defaults to real time. */
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	now?: () => number;
};

export type RunCaseScriptResult = {
	ok: boolean;
	/** Actions that finished ok. */
	completed: number;
	total: number;
	/** 0-based index of the action that failed, or where an abort stopped the replay. */
	failedIndex?: number;
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
 * The device request behind a Case Script action, or `null` for `wait` / `assert`
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
		case "wait":
		case "assert":
			return null;
	}
}

/** The `yoqa` shell command a Case Script action replays as (for logs and reports). */
export function caseScriptActionCommand(action: CaseScriptAction): string {
	if (action.type === "wait") {
		const seconds = action.ms / 1000;
		return `sleep ${Number.isInteger(seconds) ? seconds : Number(seconds.toFixed(3))}`;
	}
	if (action.type === "assert") {
		const timeout =
			action.timeoutMs != null
				? ` --timeout ${Math.max(1, Math.round(action.timeoutMs / 1000))}`
				: "";
		return `yoqa assert ${action.assertion} --text '${action.text.replace(/'/g, `'\\''`)}'${timeout}`;
	}
	const request = caseScriptActionRequest(action);
	return request ? formatActionShellLine(request) : action.type;
}

/**
 * Replay a Case Script on the Active Session, action by action, without any decide.
 * Stops at the first failing action and reports every later action as skipped.
 */
export async function runCaseScript(
	client: CaseScriptReplayClient,
	script: CaseScript,
	options: RunCaseScriptOptions = {},
): Promise<RunCaseScriptResult> {
	const sleep = options.sleep ?? realSleep;
	const now = options.now ?? Date.now;
	const pollMs = options.assertPollMs ?? 400;
	const { actions } = script;
	const total = actions.length;

	const skipFrom = async (from: number) => {
		for (let index = from; index < total; index++) {
			const action = actions[index];
			if (action) await options.onStep?.({ index, total, action, status: "skipped" });
		}
	};

	const assertText = async (action: Extract<CaseScriptAction, { type: "assert" }>) => {
		const timeoutMs =
			action.timeoutMs ?? options.defaultAssertTimeoutMs ?? DEFAULT_ASSERT_TIMEOUT_MS;
		const deadline = now() + timeoutMs;
		const seconds = Math.round(timeoutMs / 1000);
		for (;;) {
			if (options.signal?.aborted) throw abortError();
			// A read can fail while the app is still coming up; that is "not there yet".
			let readError: unknown = null;
			try {
				const screen = await client.getScreen();
				const found = screenHasText(screen.elements, action.text);
				if (action.assertion === "visible" ? found : !found) return;
			} catch (error) {
				readError = error;
			}
			if (now() >= deadline) {
				if (readError) {
					const message = readError instanceof Error ? readError.message : String(readError);
					throw new Error(`Could not read the screen within ${seconds}s: ${message}`);
				}
				throw new Error(
					action.assertion === "visible"
						? `Expected visible text not found within ${seconds}s: ${action.text}`
						: `Unexpected text still visible after ${seconds}s: ${action.text}`,
				);
			}
			await sleep(pollMs, options.signal);
		}
	};

	for (let index = 0; index < total; index++) {
		const action = actions[index];
		if (!action) continue;
		if (options.signal?.aborted) {
			await skipFrom(index);
			return { ok: false, completed: index, total, failedIndex: index, error: "Aborted" };
		}
		await options.onStep?.({ index, total, action, status: "running" });
		try {
			let response: ActionResponse | undefined;
			if (action.type === "wait") {
				await sleep(action.ms, options.signal);
			} else if (action.type === "assert") {
				await assertText(action);
			} else {
				const request = caseScriptActionRequest(action);
				if (request) response = await client.performAction(request);
				if (options.pauseAfterActionMs) await sleep(options.pauseAfterActionMs, options.signal);
			}
			await options.onStep?.({
				index,
				total,
				action,
				status: "ok",
				...(response ? { response } : {}),
			});
		} catch (error) {
			const aborted =
				options.signal?.aborted || (error instanceof Error && error.name === "AbortError");
			const message = aborted ? "Aborted" : error instanceof Error ? error.message : String(error);
			await options.onStep?.({ index, total, action, status: "error", error: message });
			await skipFrom(index + 1);
			return { ok: false, completed: index, total, failedIndex: index, error: message };
		}
	}

	return { ok: true, completed: total, total };
}
