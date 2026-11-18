import { PanelEmpty } from "@/features/auto/components/auto-panel-empty";
import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import { useCaseHistory } from "@/features/auto/hooks/usequery/use-auto";
import {
	type BarTone,
	type DurationBar,
	durationBars,
	historyNoteText,
	historyStats,
	runMeta,
	runTitle,
	stepStripLabel,
	stepsHeader,
} from "@/features/auto/utils/history";
import { Tooltip } from "@heroui/react";
import { useValue } from "@legendapp/state/react";
import { Link } from "@tanstack/react-router";
import type { CaseHistory, HistoryNote, HistoryRun, HistoryStepResult } from "@yoqa/runner-client";

const BAR_FILL: Record<BarTone, string> = {
	passed: "bg-secondary",
	failed: "bg-error",
	running: "border-[1.5px] border-dashed border-violet bg-transparent",
	stopped: "bg-outline",
};

const LEGEND: Record<BarTone, string> = {
	passed: "passed",
	failed: "failed",
	running: "in progress",
	stopped: "stopped",
};

const CELL_FILL: Record<HistoryStepResult, string> = {
	passed: "bg-secondary",
	failed: "bg-error",
	running: "bg-violet motion-live-dot",
	skipped: "bg-outline-variant",
	pending: "bg-surface-container-highest",
};

/**
 * The chat's Test Case's History: its pass rate, average passing time and failing count,
 * the time of each recent Run, one strip of step results per Run, and the note. The chat's
 * own Run shows as it goes.
 */
export function AutoHistoryTab() {
	const loaded = useValue(() => shownAutoChat$.chat.get() !== null);
	const caseId = useValue(shownAutoChat$.chat.caseId);
	if (!loaded) {
		return <PanelEmpty title="Loading History">Opening the chat.</PanelEmpty>;
	}
	if (!caseId) {
		return (
			<PanelEmpty title="No Test Case yet">
				Once the chat works on a Test Case, its pass rate and recent Runs show here.
			</PanelEmpty>
		);
	}
	return <CaseHistoryPanel caseId={caseId} />;
}

function CaseHistoryPanel({ caseId }: { caseId: string }) {
	const chatId = useValue(shownAutoChat$.chatId);
	const caseNumber = useValue(shownAutoChat$.chat.caseNumber);
	const caseName = useValue(shownAutoChat$.chat.caseName);
	const runKey = useValue(() => {
		const run = shownAutoChat$.chat.run.get();
		return run ? `${run.runId}:${run.status}:${run.currentStep ?? ""}` : "";
	});
	const history = useCaseHistory(caseId, runKey);

	if (!history.data) {
		return (
			<PanelEmpty title={history.isError ? "History could not load" : "Loading History"}>
				{history.isError ? history.error.message : "Reading the case's recent Runs."}
			</PanelEmpty>
		);
	}
	// Relative times are as of when the summary was read.
	const now = history.dataUpdatedAt;
	const { runs } = history.data;

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-col gap-3.5 border-b border-outline-variant pb-4">
				<div className="flex items-baseline justify-between gap-2">
					<span className="truncate text-body font-semibold text-on-surface">
						{caseNumber ? `#${caseNumber} ${caseName ?? ""}` : (caseName ?? "Test Case")}
					</span>
					<Link
						className="shrink-0 text-helper font-medium text-primary no-underline hover:underline"
						to="/runs"
					>
						All runs
					</Link>
				</div>
				<StatTiles history={history.data} />
				{runs.length > 0 ? <DurationChart chatId={chatId} now={now} runs={runs} /> : null}
				{history.data.note ? <NoteCard note={history.data.note} now={now} /> : null}
			</div>
			{runs.length === 0 ? (
				<p className="m-0 pt-4 text-body-sm text-on-surface-variant">
					This case has not run yet. Its Runs, from here or the Runs page, show here.
				</p>
			) : (
				<RunList chatId={chatId} now={now} runs={runs} />
			)}
		</div>
	);
}

function StatTiles({ history }: { history: CaseHistory }) {
	return (
		<dl className="m-0 grid grid-cols-3 gap-2">
			{historyStats(history).map((stat) => (
				<div className="rounded-[10px] bg-surface-container p-2.5" key={stat.label}>
					<dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-outline">
						{stat.label}
					</dt>
					<dd
						className={[
							"m-0 mt-1 text-[20px] font-semibold",
							stat.failing ? "text-error" : "text-on-surface",
						].join(" ")}
					>
						{stat.value}
					</dd>
				</div>
			))}
		</dl>
	);
}

function DurationChart({
	runs,
	chatId,
	now,
}: {
	runs: HistoryRun[];
	chatId: string | null;
	now: number;
}) {
	const bars = durationBars(runs, now);
	const byId = new Map(runs.map((run) => [run.runId, run]));
	const tones = (Object.keys(LEGEND) as BarTone[]).filter((tone) =>
		bars.some((bar) => bar.tone === tone),
	);
	return (
		<figure className="m-0">
			<figcaption className="mb-2 flex items-center justify-between gap-2">
				<span className="text-[11px] font-medium uppercase tracking-[0.06em] text-outline">
					Duration per run
				</span>
				<span className="flex gap-2.5 text-[11px] text-outline">
					{tones.map((tone) => (
						<span className="flex items-center gap-1" key={tone}>
							<span aria-hidden="true" className={`block size-2 rounded-sm ${BAR_FILL[tone]}`} />
							{LEGEND[tone]}
						</span>
					))}
				</span>
			</figcaption>
			<div className="flex h-[76px] items-end gap-2 border-b border-outline-variant pb-1">
				{bars.map((bar) => (
					<Bar bar={bar} detail={chartDetail(byId.get(bar.runId), chatId, now)} key={bar.runId} />
				))}
			</div>
			<div aria-hidden="true" className="mt-1 flex gap-2">
				{bars.map((bar) => (
					<span className="flex-1 text-center font-mono text-[10px] text-outline" key={bar.runId}>
						#{bar.number}
					</span>
				))}
			</div>
		</figure>
	);
}

function chartDetail(run: HistoryRun | undefined, chatId: string | null, now: number): string {
	return run ? `${runTitle(run, chatId)}: ${runMeta(run, now)}` : "";
}

/** One Run's bar, its time above it; hover or focus names the Run and how it went. */
function Bar({ bar, detail }: { bar: DurationBar; detail: string }) {
	return (
		<Tooltip delay={150}>
			<Tooltip.Trigger
				aria-label={detail}
				className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary"
			>
				<span className="font-mono text-[10px] text-outline">{bar.label}</span>
				<span
					className={`box-border block w-full rounded-t ${BAR_FILL[bar.tone]}`}
					style={{ height: `calc((100% - 18px) * ${bar.heightPct / 100})` }}
				/>
			</Tooltip.Trigger>
			<Tooltip.Content placement="top">{detail}</Tooltip.Content>
		</Tooltip>
	);
}

function NoteCard({ note, now }: { note: HistoryNote; now: number }) {
	const { title, detail } = historyNoteText(note, now);
	return (
		<div className="flex gap-2.5 rounded-[10px] border border-outline-variant bg-surface-container-lowest px-3 py-2.5">
			<svg
				aria-hidden="true"
				className={`mt-px shrink-0 ${note.kind === "consistent" ? "text-error" : "text-on-surface-variant"}`}
				fill="none"
				height="16"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="2"
				viewBox="0 0 24 24"
				width="16"
			>
				<path d="M12 9v4M12 17h.01" />
				<path d="M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
			</svg>
			<p className="m-0 text-body-sm leading-normal text-on-surface">
				<b className="font-semibold">{title}</b>{" "}
				<span className="text-on-surface-variant">{detail}</span>
			</p>
		</div>
	);
}

function RunList({
	runs,
	chatId,
	now,
}: {
	runs: HistoryRun[];
	chatId: string | null;
	now: number;
}) {
	return (
		<div className="flex min-h-0 flex-1 flex-col pt-2">
			<div className="flex justify-between py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-outline">
				<span>Runs</span>
				<span>{stepsHeader(runs)}</span>
			</div>
			<ol className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">
				{runs.map((run) => (
					<li className="border-t border-outline-variant" key={run.runId}>
						<Link
							className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3.5 py-2.5 text-on-surface no-underline hover:bg-surface-container-low"
							params={{ runId: run.runId }}
							to="/runs/$runId"
						>
							<span className="flex min-w-0 flex-col gap-0.5">
								<span className="truncate text-body-sm font-medium">{runTitle(run, chatId)}</span>
								<span className="truncate text-helper text-outline">{runMeta(run, now)}</span>
							</span>
							<span aria-label={stepStripLabel(run.steps)} className="flex gap-[3px]" role="img">
								{run.steps.map((result, index) => (
									<span
										className={`h-2 flex-1 rounded-sm ${CELL_FILL[result]}`}
										// biome-ignore lint/suspicious/noArrayIndexKey: a step's place is its identity here
										key={index}
									/>
								))}
							</span>
						</Link>
					</li>
				))}
			</ol>
		</div>
	);
}
