import { PanelEmpty } from "@/features/auto/components/auto-panel-empty";
import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import {
	type DraftChangeRow,
	draftChangeRows,
	unchangedLabel,
} from "@/features/auto/utils/case-draft";
import { useObservable, useValue } from "@legendapp/state/react";
import type { CaseDraft, CaseFlowStep } from "@yoqa/runner-client";

type DraftView = "changes" | "full";

const VIEWS: { id: DraftView; label: string }[] = [
	{ id: "changes", label: "Changes" },
	{ id: "full", label: "Full test" },
];

/**
 * The chat's Case draft: its changes against the saved Test Case, or the whole case as it
 * would be saved. It follows the chat's events, so the agent's edits show as they are made.
 */
export function AutoTestTab() {
	const draft = useValue(shownAutoChat$.chat.draft);
	const caseNumber = useValue(shownAutoChat$.chat.caseNumber);
	const view$ = useObservable<DraftView>("changes");
	const view = useValue(view$);

	if (!draft) {
		return (
			<PanelEmpty title="No Case draft">
				{caseNumber
					? `In Run mode, ask the chat agent to fix #${caseNumber}: its proposed steps show here as changes to the saved Test Case.`
					: "Once the chat works on a Test Case, the steps the chat agent proposes in Run mode show here."}
			</PanelEmpty>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			<div className="flex items-center gap-2">
				<fieldset
					aria-label="Case draft view"
					className="m-0 inline-flex gap-1 rounded-lg border-0 bg-surface-container p-0.5"
				>
					{VIEWS.map((item) => {
						const selected = item.id === view;
						return (
							<button
								aria-pressed={selected}
								className={[
									"rounded-md px-2.5 py-1 text-helper font-medium transition-colors duration-[var(--motion-fast)]",
									selected
										? "bg-surface-container-lowest text-on-surface shadow-card"
										: "text-on-surface-variant hover:text-on-surface",
								].join(" ")}
								key={item.id}
								onClick={() => view$.set(item.id)}
								type="button"
							>
								{item.label}
							</button>
						);
					})}
				</fieldset>
				<span className="ml-auto text-helper text-on-surface-variant">
					{draft.steps.length} {draft.steps.length === 1 ? "step" : "steps"}
				</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{view === "changes" ? <DraftChanges draft={draft} /> : <DraftFullTest draft={draft} />}
			</div>
		</div>
	);
}

function DraftChanges({ draft }: { draft: CaseDraft }) {
	const rows = draftChangeRows(draft);
	return (
		<ol className="m-0 flex list-none flex-col gap-2 p-0">
			{rows.map((row) => (
				<li key={rowKey(row)}>
					<ChangeRow row={row} />
				</li>
			))}
		</ol>
	);
}

function rowKey(row: DraftChangeRow): string {
	switch (row.kind) {
		case "unchanged":
			return `unchanged-${row.from}`;
		case "removed":
			return `removed-${row.before.id}`;
		default:
			return `${row.kind}-${row.after.id}`;
	}
}

const BADGE: Record<
	Exclude<DraftChangeRow["kind"], "unchanged">,
	{ label: string; className: string }
> = {
	changed: { label: "Changed", className: "bg-secondary-container text-on-secondary-container" },
	moved: { label: "Moved", className: "bg-secondary-container text-on-secondary-container" },
	added: { label: "Added", className: "bg-warning-container text-on-warning-container" },
	removed: { label: "Removed", className: "bg-error-container text-on-error-container" },
};

function ChangeRow({ row }: { row: DraftChangeRow }) {
	if (row.kind === "unchanged") {
		return (
			<p className="m-0 rounded-lg border border-dashed border-outline-variant px-3 py-1.5 text-helper text-on-surface-variant">
				{unchangedLabel(row)}
			</p>
		);
	}
	const badge = BADGE[row.kind];
	return (
		<article className="flex flex-col gap-2 rounded-lg border border-outline-variant bg-surface-container-low p-3">
			<header className="flex items-center gap-2">
				<span className="text-body-sm font-medium text-on-surface">{changeTitle(row)}</span>
				<span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>
					{badge.label}
				</span>
			</header>
			<p className="m-0 text-helper text-on-surface-variant">{row.reason}</p>
			{row.kind === "changed" || row.kind === "removed" ? (
				<StepText label="Before" step={row.before} muted />
			) : null}
			{row.kind === "changed" || row.kind === "added" ? (
				<StepText label="After" step={row.after} />
			) : null}
			{row.kind === "moved" ? <StepText step={row.after} /> : null}
		</article>
	);
}

function changeTitle(row: Exclude<DraftChangeRow, { kind: "unchanged" }>): string {
	switch (row.kind) {
		case "removed":
			return `Saved step ${row.savedNumber}`;
		case "moved":
			return `Step ${row.number}, was step ${row.savedNumber}`;
		default:
			return `Step ${row.number}`;
	}
}

function StepText({ label, step, muted }: { label?: string; step: CaseFlowStep; muted?: boolean }) {
	return (
		<div className={muted ? "min-w-0 opacity-70" : "min-w-0"}>
			{label ? (
				<p className="m-0 text-[11px] font-medium uppercase tracking-wide text-outline">{label}</p>
			) : null}
			<p className="m-0 whitespace-pre-wrap break-words text-body-sm text-on-surface">
				{step.instructions || "(no instructions)"}
			</p>
			<p className="m-0 whitespace-pre-wrap break-words text-helper text-on-surface-variant">
				Expected: {step.expectedResult || "(none)"}
			</p>
		</div>
	);
}

function DraftFullTest({ draft }: { draft: CaseDraft }) {
	if (draft.steps.length === 0) {
		return <p className="m-0 text-body-sm text-on-surface-variant">The draft has no steps.</p>;
	}
	return (
		<ol className="m-0 flex list-none flex-col gap-2 p-0">
			{draft.steps.map((step, index) => (
				<li
					className="flex gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3"
					key={step.id}
				>
					<span className="shrink-0 text-body-sm font-medium text-outline">{index + 1}</span>
					<StepText step={step} />
				</li>
			))}
		</ol>
	);
}
