import type {
	AutoRun,
	AutoRunControl,
	AutoRunStep,
	CaseDraft,
	CaseFlowStep,
	CatalogCase,
	Run,
} from "@yoqa/runner-client";
import { getActiveSessionInfo } from "../devices/active-session";
import { getProvider, resolveActiveProviderAuth } from "../providers/application";
import {
	type RunPause,
	RunValidationError,
	cancelRun,
	createDraftRun,
	getRun,
	pauseRun,
	resumeRun,
	runPauseOf,
	takeOverRun,
} from "../runs/application";
import { draftMode } from "../runs/run-setup";
import { reachedStep } from "../runs/step-progress";

/**
 * Runs of a chat's Case draft: started by the chat agent, driven by the Case executor on
 * the connected device, and followed for the chat's Run card from the Run's own steps.
 */

/** How often a Run in progress is read again for its Run card. */
const FOLLOW_INTERVAL_MS = 250;

/** Each chat's Run of its draft in progress, as its Run card shows it. */
const chatRuns = new Map<string, AutoRun>();
/** The chats starting or following a Run of their draft: one at a time each. */
const runningChats = new Set<string>();
/** For each chat's Run in progress: read it again and show its Run card now, not at the next read. */
const showRunCardNow = new Map<string, () => Promise<void>>();

/** The chat's Run of its draft in progress; null when none is. */
export function currentChatRun(chatId: string): AutoRun | null {
	return chatRuns.get(chatId) ?? null;
}

/** Whether the chat is starting or following a Run of its draft. */
export function chatRunInProgress(chatId: string): boolean {
	return runningChats.has(chatId);
}

/** Stop the chat's Run in progress through the Run's own cancel. False when none is. */
export async function stopChatRun(chatId: string): Promise<boolean> {
	const run = chatRuns.get(chatId);
	if (!run) return false;
	await cancelRun(run.runId);
	return true;
}

const CONTROLS: Record<AutoRunControl, (runId: string) => void> = {
	pause: pauseRun,
	"take-over": takeOverRun,
	resume: resumeRun,
};

/**
 * Pause, take over or resume the chat's Run in progress, its Run card shown again at once.
 * Why it cannot, as text, when it cannot.
 */
export async function controlChatRun(
	chatId: string,
	control: AutoRunControl,
): Promise<string | null> {
	const run = chatRuns.get(chatId);
	if (!run) return "No Run of this chat is in progress.";
	try {
		CONTROLS[control](run.runId);
	} catch (error) {
		if (error instanceof RunValidationError) return error.message;
		throw error;
	}
	await showRunCardNow.get(chatId)?.();
	return null;
}

function stepStatus(
	test: Run["tests"][number] | undefined,
	runStatus: Run["status"],
	index: number,
	reached: number,
): AutoRunStep["status"] {
	const status = runStatus === "cancelled" ? "cancelled" : test?.status;
	if (status === "passed") return "passed";
	// A replayed Case Script does not say which step it is on.
	if (test?.executionMode !== "agent" || index > reached) return "pending";
	if (index < reached) return "passed";
	if (status === "running") return "running";
	if (status === "errored") return "failed";
	if (status === "cancelled") return "stopped";
	return "pending";
}

/**
 * A Run of a draft's `flows` as its Run card shows it: each step's status and the commands
 * it ran, read from the Run's steps (each agent step knows its step of the case).
 */
function autoRunOf(
	run: Run,
	flows: CaseFlowStep[],
	provider: string | null,
	pause: RunPause | null,
): AutoRun {
	const test = run.tests[0];
	const runSteps = test?.steps ?? [];
	const reached = reachedStep(runSteps, flows);
	const running = test?.status === "running" && run.status === "running";
	const agent = test?.executionMode === "agent";
	return {
		runId: run.id,
		caseId: test?.caseId ?? "",
		status: run.status,
		executionMode: test?.executionMode ?? null,
		provider: test?.executionMode === "script" ? null : provider,
		createdAt: run.createdAt,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		currentStep: running && agent ? reached + 1 : null,
		currentCommand: running ? (test?.currentCommand ?? null) : null,
		pause: running ? pause : null,
		steps: flows.map((flow, index) => ({
			instructions: flow.instructions,
			expectedResult: flow.expectedResult,
			status: stepStatus(test, run.status, index, reached),
			commands: runSteps.flatMap((step) =>
				step.action.flowStep === index && step.command ? [step.command] : [],
			),
		})),
		replayed:
			test?.executionMode === "script"
				? runSteps.flatMap((step) => (step.command ? [step.command] : []))
				: [],
		error: test?.error ?? run.error,
	};
}

/** The vision Provider an agent Run decides with, as the Run card names it. */
async function visionProviderLabel(): Promise<string | null> {
	const auth = await resolveActiveProviderAuth();
	if (!auth) return null;
	const provider = await getProvider(auth.id).catch(() => null);
	if (!provider) return null;
	const model = auth.defaultModel ?? provider.defaultModel;
	return model ? `${provider.label} · ${model}` : provider.label;
}

/** How a chat's Run of its draft ended. */
export type ChatRunResult = {
	run: Run;
	/** The Case Script a passed Run learned, or the draft's own one it replayed. */
	passingScript: CaseDraft["learnedScript"];
	/** The user took the Run over at some point, so it is not a clean Run. */
	takenOver: boolean;
};

/** What a chat's Run of its draft starts from, and where its Run card goes. */
type ChatRunInput = {
	chatId: string;
	catalogCase: CatalogCase;
	draft: CaseDraft;
	signal: AbortSignal;
	report: (run: AutoRun) => void;
};

/**
 * Run the whole of `draft` of `catalogCase` on the connected device, from the App's start,
 * and wait for it to end. `report` gets the Run card each time it changes, and once more at
 * the end; `signal` stops the Run. Why it cannot start, as text, when it cannot.
 */
export async function runChatDraft(input: ChatRunInput): Promise<ChatRunResult | string> {
	const { chatId } = input;
	if (runningChats.has(chatId)) {
		return "A Run of this Case draft is already in progress. Wait for it to end.";
	}
	runningChats.add(chatId);
	try {
		return await startAndFollow(input);
	} finally {
		runningChats.delete(chatId);
		chatRuns.delete(chatId);
	}
}

/** Start the Run of the draft, then follow it until it ends. */
async function startAndFollow(input: ChatRunInput): Promise<ChatRunResult | string> {
	const { chatId, catalogCase, draft } = input;
	const device = getActiveSessionInfo();
	if (!device) {
		return "No device is connected. Ask the user to connect one from the top bar, then run again.";
	}
	if (device.heldByRun) {
		return "Another Run is using the device. Wait for it to end, then run again.";
	}
	const flows = draft.steps.map(({ reason: _reason, ...step }) => step);
	const steps = { flows, script: draft.learnedScript };
	let started: Awaited<ReturnType<typeof createDraftRun>>;
	try {
		started = await createDraftRun({
			appId: catalogCase.appId,
			caseId: catalogCase.id,
			deviceId: device.deviceId,
			platform: device.platform,
			executionMode: "auto",
			...(device.platform === "web" && device.viewport ? { viewport: device.viewport } : {}),
			steps,
			chatId,
		});
	} catch (error) {
		if (error instanceof RunValidationError) return error.message;
		throw error;
	}
	const { run: created, outcome } = started;
	const provider = draftMode("auto", steps) === "agent" ? await visionProviderLabel() : null;

	let lastCardJson = "";
	const show = (run: Run) => {
		const card = autoRunOf(run, flows, provider, runPauseOf(run.id));
		const json = JSON.stringify(card);
		if (json === lastCardJson) return;
		lastCardJson = json;
		chatRuns.set(chatId, card);
		input.report(card);
	};
	const stop = () => void cancelRun(created.id).catch(() => undefined);
	input.signal.addEventListener("abort", stop, { once: true });
	showRunCardNow.set(chatId, async () => {
		const run = await getRun(created.id).catch(() => null);
		if (run) show(run);
	});
	show(created);
	try {
		let ended = false;
		void outcome.then(() => {
			ended = true;
		});
		while (!ended) {
			await Promise.race([Bun.sleep(FOLLOW_INTERVAL_MS), outcome]);
			const run = await getRun(created.id).catch(() => null);
			if (run) show(run);
		}
		const result = await outcome;
		// Deleted from the Runs page before it ended: there is nothing left to read.
		const run = await getRun(created.id).catch(() => null);
		if (!run) return `Run ${created.id} was deleted before it ended.`;
		show(run);
		return {
			run,
			passingScript:
				result.status === "passed" ? (result.learnedScript ?? draft.learnedScript) : null,
			takenOver: result.takenOver,
		};
	} finally {
		input.signal.removeEventListener("abort", stop);
		showRunCardNow.delete(chatId);
	}
}
