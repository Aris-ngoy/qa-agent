import type {
	AutoChatMode,
	AutoChatSummary,
	CaseDraft,
	CatalogCase,
	Run,
	RunStep,
} from "@yoqa/runner-client";
import { z } from "zod";
import { listCases } from "../catalog/application";
import { RunNotFoundError, getRun, listRuns } from "../runs/application";
import { addStep, changeStep, describeDraft, removeStep, setSteps, startDraft } from "./case-draft";
import type { ChatTool, ChatToolOutput } from "./chat-agent";
import type { ChatRunResult } from "./chat-runs";

/** What the Yoqa tools of one chat read and change. */
export type ChatToolContext = {
	appId: string;
	/** The Test Case the chat works on, read when a tool runs (it may have just been set). */
	caseId: () => Promise<string | null>;
	/** Set the chat's Test Case while it has none; null when it already had one. */
	setCase: (caseId: string) => Promise<AutoChatSummary | null>;
	/** The chat's Case draft of its Test Case `caseId`; null before the agent writes one. */
	draft: (caseId: string) => Promise<CaseDraft | null>;
	saveDraft: (draft: CaseDraft) => Promise<void>;
	/**
	 * Run the whole of `draft` of `catalogCase` on the connected device and wait for it to
	 * end, recording a passing Run on the draft; why it cannot start, as text.
	 */
	runDraft: (catalogCase: CatalogCase, draft: CaseDraft) => Promise<ChatDraftRun | string>;
};

/** A chat's Run of its draft once it ended, and whether it is now the draft's passing Run. */
export type ChatDraftRun = ChatRunResult & { passing: boolean };

const ALL_MODES: AutoChatMode[] = ["ask", "run", "explore"];
/** The modes that may write the Case draft. */
const DRAFT_MODES: AutoChatMode[] = ["run", "explore"];
const STEP_DETAIL_LIMIT = 200;

const MODE_LABEL: Record<AutoChatMode, string> = { ask: "Ask", run: "Run", explore: "Explore" };

function answer(text: string): ChatToolOutput {
	return { text, isError: false };
}

function refuse(text: string): ChatToolOutput {
	return { text, isError: true };
}

function when(at: number): string {
	return new Date(at).toISOString().replace(".000Z", "Z");
}

function caseLabel(catalogCase: Pick<CatalogCase, "number" | "name">): string {
	return `#${catalogCase.number} ${catalogCase.name}`;
}

/** A Test Case as text: its steps, its Case Script and its last result. */
export function describeCase(catalogCase: CatalogCase): string {
	const steps = catalogCase.flows.map(
		(step, index) =>
			`${index + 1}. ${step.instructions || "(no instructions)"}\n   Expected: ${step.expectedResult || "(none)"}`,
	);
	const script = catalogCase.script
		? `${catalogCase.script.actions.length} actions, saved ${when(catalogCase.scriptSavedAt ?? catalogCase.script.savedAt)}`
		: "none";
	const lastResult =
		catalogCase.lastRunStatus && catalogCase.lastRunAt
			? `${catalogCase.lastRunStatus} at ${when(catalogCase.lastRunAt)}`
			: "never run";
	return [
		caseLabel(catalogCase),
		steps.length > 0 ? `Steps:\n${steps.join("\n")}` : "Steps: none",
		`Case Script: ${script}`,
		`Last result: ${lastResult}`,
	].join("\n");
}

function stepLine(step: RunStep): string {
	const { type, reason } = step.action;
	const what = `${type ?? "step"}${reason ? `: ${reason}` : ""}`;
	const detail = step.detail ? ` — ${step.detail.slice(0, STEP_DETAIL_LIMIT)}` : "";
	const command = step.command ? ` [${step.command}]` : "";
	return `  ${step.idx + 1}. ${step.ok ? "ok" : "FAILED"} ${what}${detail}${command}`;
}

/** A Run as text: its outcome, then each case with its steps. */
export function describeRun(run: Run, caseLabels: Map<string, string>): string {
	const lines = [
		`Run ${run.id} · ${run.status} · ${run.platform} on ${run.deviceId} · ${run.executionMode} · created ${when(run.createdAt)}`,
	];
	if (run.error) lines.push(`Error: ${run.error}`);
	for (const test of run.tests) {
		lines.push(
			`${caseLabels.get(test.caseId) ?? test.caseId} · ${test.status}${test.executionMode ? ` · ${test.executionMode}` : ""}`,
		);
		if (test.error) lines.push(`  Error: ${test.error}`);
		for (const step of test.steps ?? []) lines.push(stepLine(step));
	}
	return lines.join("\n");
}

/** A tool, its input's type read from its input shape. */
function chatTool<Shape extends z.ZodRawShape>(tool: ChatTool<Shape>): ChatTool {
	return tool as unknown as ChatTool;
}

const stepTextShape = {
	instructions: z.string().trim().min(1),
	expectedResult: z.string(),
};
const reasonSchema = z.string().trim().min(1);

/** The Yoqa tools of one chat, each with the modes that allow it. */
export function chatTools(context: ChatToolContext): ChatTool[] {
	/** A case of the chat's App by number, or the chat's own case when no number is given. */
	async function findCase(number: number | undefined): Promise<CatalogCase | string> {
		const appCases = await listCases(context.appId);
		if (number !== undefined) {
			return (
				appCases.find((item) => item.number === number) ??
				`There is no Test Case #${number} in this App.`
			);
		}
		const caseId = await context.caseId();
		return (
			appCases.find((item) => item.id === caseId) ??
			"This chat has no Test Case yet. Name one by number, or set it with set_test_case."
		);
	}

	async function caseLabels(): Promise<Map<string, string>> {
		const appCases = await listCases(context.appId);
		return new Map(appCases.map((item) => [item.id, caseLabel(item)]));
	}

	const getTestCase = chatTool({
		name: "get_test_case",
		description:
			"Read a Test Case: its steps (instructions and expected results), its Case Script and its last result. Without a number, the chat's own Test Case.",
		modes: ALL_MODES,
		input: { number: z.number().int().positive().optional() },
		run: async ({ number }) => {
			const found = await findCase(number);
			return typeof found === "string" ? refuse(found) : answer(describeCase(found));
		},
	});

	const listCaseRuns = chatTool({
		name: "list_runs",
		description:
			"List the latest Runs of a Test Case, newest first: id, status, when, how it ran and its error. Without a number, the chat's own Test Case.",
		modes: ALL_MODES,
		input: {
			number: z.number().int().positive().optional(),
			limit: z.number().int().min(1).max(20).optional(),
		},
		run: async ({ number, limit }) => {
			const found = await findCase(number);
			if (typeof found === "string") return refuse(found);
			const runs = (await listRuns(context.appId))
				.filter((run) => run.tests.some((test) => test.caseId === found.id))
				.slice(0, limit ?? 5);
			if (runs.length === 0) return answer(`No Runs of ${caseLabel(found)} yet.`);
			const lines = runs.map((run) => {
				const test = run.tests.find((item) => item.caseId === found.id);
				const mode = test?.executionMode ? ` · ${test.executionMode}` : "";
				const error = test?.error ? ` · ${test.error}` : "";
				return `${run.id} · ${test?.status ?? run.status} · ${when(run.createdAt)}${mode}${error}`;
			});
			return answer(`Runs of ${caseLabel(found)}:\n${lines.join("\n")}`);
		},
	});

	const getRunDetail = chatTool({
		name: "get_run",
		description:
			"Read one Run of this App: its outcome, and each case's steps in order with what each did, whether it worked and why not.",
		modes: ALL_MODES,
		input: { runId: z.string().min(1) },
		run: async ({ runId }) => {
			try {
				const run = await getRun(runId);
				if (run.appId !== context.appId) return refuse(`Run ${runId} is not one of this App's.`);
				return answer(describeRun(run, await caseLabels()));
			} catch (error) {
				if (error instanceof RunNotFoundError) return refuse(`There is no Run ${runId}.`);
				throw error;
			}
		},
	});

	const setTestCase = chatTool({
		name: "set_test_case",
		description:
			"Set the Test Case this chat works on, by number. Only once: a chat that already has one keeps it (another case needs a new chat).",
		modes: ALL_MODES,
		input: { number: z.number().int().positive() },
		run: async ({ number }) => {
			const refuseTaken = async () => {
				const current = await findCase(undefined);
				const label = typeof current === "string" ? "a Test Case" : caseLabel(current);
				return refuse(`This chat already works on ${label}. Another Test Case needs a new chat.`);
			};
			if (await context.caseId()) return refuseTaken();
			const found = await findCase(number);
			if (typeof found === "string") return refuse(found);
			if (!(await context.setCase(found.id))) return refuseTaken();
			return answer(`This chat now works on ${caseLabel(found)}.`);
		},
	});

	/** The chat's own Test Case, which the Case draft tools need. */
	async function chatCase(): Promise<CatalogCase | string> {
		const found = await findCase(undefined);
		return typeof found === "string"
			? "This chat has no Test Case yet, so there is no Case draft. Set one with set_test_case first."
			: found;
	}

	/** Make one change to the Case draft, started from the saved steps, and answer the new draft. */
	async function writeDraft(
		change: (draft: CaseDraft) => CaseDraft | string,
	): Promise<ChatToolOutput> {
		const found = await chatCase();
		if (typeof found === "string") return refuse(found);
		const written = change((await context.draft(found.id)) ?? startDraft(found));
		if (typeof written === "string") return refuse(written);
		await context.saveDraft(written);
		return answer(describeDraft(written, caseLabel(found)));
	}

	const getCaseDraft = chatTool({
		name: "get_case_draft",
		description:
			"Read the chat's Case draft: the steps proposed for its Test Case, numbered, with what changed and why, and the saved steps it removes.",
		modes: ALL_MODES,
		input: {},
		run: async () => {
			const found = await chatCase();
			if (typeof found === "string") return refuse(found);
			const draft = await context.draft(found.id);
			return answer(
				draft
					? describeDraft(draft, caseLabel(found))
					: `There is no Case draft of ${caseLabel(found)} yet: its steps are as saved.`,
			);
		},
	});

	const setDraftSteps = chatTool({
		name: "set_draft_steps",
		description:
			"Write the whole Case draft at once, in order. Give a step savedStep (its number in the saved Test Case) when it rewrites that step; a step written exactly as saved stays unchanged; saved steps you leave out are removed. A step may give its own reason in place of the call's. Never changes the saved Test Case.",
		modes: DRAFT_MODES,
		input: {
			steps: z
				.array(
					z.object({
						...stepTextShape,
						savedStep: z.number().int().positive().optional(),
						reason: reasonSchema.optional(),
					}),
				)
				.min(1),
			reason: reasonSchema,
		},
		run: async (input) => writeDraft((draft) => setSteps(draft, input.steps, input.reason)),
	});

	const addDraftStep = chatTool({
		name: "add_draft_step",
		description:
			"Add a step to the Case draft, at position (the step number it becomes) or at the end.",
		modes: DRAFT_MODES,
		input: {
			...stepTextShape,
			position: z.number().int().positive().optional(),
			reason: reasonSchema,
		},
		run: async (input) =>
			writeDraft((draft) => addStep(draft, input, input.position, input.reason)),
	});

	const changeDraftStep = chatTool({
		name: "change_draft_step",
		description:
			"Change one step of the Case draft, by its number in the draft: its instructions, its expected result, or both.",
		modes: DRAFT_MODES,
		input: {
			step: z.number().int().positive(),
			instructions: stepTextShape.instructions.optional(),
			expectedResult: z.string().optional(),
			reason: reasonSchema,
		},
		run: async ({ step, instructions, expectedResult, reason }) =>
			writeDraft((draft) => changeStep(draft, step, { instructions, expectedResult }, reason)),
	});

	const removeDraftStep = chatTool({
		name: "remove_draft_step",
		description: "Remove one step from the Case draft, by its number in the draft.",
		modes: DRAFT_MODES,
		input: { step: z.number().int().positive(), reason: reasonSchema },
		run: async ({ step, reason }) => writeDraft((draft) => removeStep(draft, step, reason)),
	});

	const runCaseDraft = chatTool({
		name: "run_case_draft",
		description:
			"Run the whole Case draft on the connected device, from the App's start, and wait for it to end. The Yoqa agent drives the device (or replays the draft's Case Script); the answer is each step as text. A passing Run lets the user apply the draft. Never changes the saved Test Case.",
		modes: DRAFT_MODES,
		input: {},
		run: async () => {
			const found = await chatCase();
			if (typeof found === "string") return refuse(found);
			const draft = await context.draft(found.id);
			if (!draft) {
				return refuse(`There is no Case draft of ${caseLabel(found)} yet: write one, then run it.`);
			}
			const result = await context.runDraft(found, draft);
			if (typeof result === "string") return refuse(result);
			const { run, passing, takenOver } = result;
			const notes = [
				run.status === "cancelled" ? "The Run was stopped before it ended." : null,
				takenOver
					? "The user took over this Run and drove the device by hand: the steps after it started from the screen they left. A Run taken over does not count, so the draft has to pass again without one."
					: null,
				passing
					? "This is now the draft's passing Run: the user can apply the draft."
					: run.status === "passed" && !takenOver
						? "The Case draft changed while it ran, so it has to pass again."
						: null,
			].filter((note) => note !== null);
			return answer([describeRun(run, await caseLabels()), ...notes].join("\n"));
		},
	});

	return [
		getTestCase,
		listCaseRuns,
		getRunDetail,
		setTestCase,
		getCaseDraft,
		setDraftSteps,
		addDraftStep,
		changeDraftStep,
		removeDraftStep,
		runCaseDraft,
	];
}

/**
 * Call one of a chat's tools in `mode`: refused when the mode does not allow it or its input
 * is wrong, and an error it throws comes back as its answer.
 */
export async function callChatTool(
	tools: ChatTool[],
	mode: AutoChatMode,
	name: string,
	input: unknown,
): Promise<ChatToolOutput> {
	const tool = tools.find((item) => item.name === name && item.modes.includes(mode));
	if (!tool) return refuse(`${name} is not available in ${MODE_LABEL[mode]} mode.`);
	const parsed = z.object(tool.input).safeParse(input ?? {});
	if (!parsed.success) return refuse(`Wrong input for ${name}: ${parsed.error.message}`);
	try {
		return await tool.run(parsed.data);
	} catch (error) {
		return refuse(error instanceof Error ? error.message : String(error));
	}
}

export { MODE_LABEL };
