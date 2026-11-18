import { PanelEmpty } from "@/features/auto/components/auto-panel-empty";
import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import {
	useAcceptAutoProposal,
	useApplyAutoDraft,
	useRejectAutoDraft,
	useRejectAutoProposal,
	useRemoveAutoDraftStep,
	useRestoreAutoPreviousVersion,
} from "@/features/auto/hooks/usequery/use-auto";
import {
	type DraftChangeRow,
	applyBlocker,
	draftChangeRows,
	unchangedLabel,
} from "@/features/auto/utils/case-draft";
import { isRunLive } from "@/features/auto/utils/run-card";
import { Button } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type { CaseDraft, CaseFlowStep, CaseProposal } from "@yoqa/runner-client";

type DraftView = "changes" | "full";

const VIEWS: { id: DraftView; label: string }[] = [
	{ id: "changes", label: "Changes" },
	{ id: "full", label: "Full test" },
];

/** Removes one step from the shown chat's draft (✕); null while the chat is not loaded. */
type RemoveStep = ((stepId: string) => void) | null;

/**
 * The chat's Case draft: its changes against the saved Test Case, or the whole case as it
 * would be saved, with ✕ on each step, Apply, Reject all and Restore previous version. Before
 * the chat has a Test Case, the one proposed in Explore, to accept or reject. It follows the
 * chat's events, so the agent's edits and Runs show as they happen.
 */
export function AutoTestTab() {
	const chatId = useValue(shownAutoChat$.chatId);
	const draft = useValue(shownAutoChat$.chat.draft);
	const caseNumber = useValue(shownAutoChat$.chat.caseNumber);
	const hasPreviousVersion = useValue(() => Boolean(shownAutoChat$.chat.previousVersion.get()));
	const view$ = useObservable<DraftView>("changes");
	const view = useValue(view$);
	const proposal = useValue(shownAutoChat$.chat.proposal);
	const removeStep = useRemoveAutoDraftStep();

	if (!draft && proposal && chatId) return <ProposalView chatId={chatId} proposal={proposal} />;

	if (!draft) {
		return (
			<div className="flex h-full min-h-0 flex-col gap-3">
				<div className="min-h-0 flex-1">
					<PanelEmpty title="No Case draft">
						{caseNumber
							? `In Run mode, ask the chat agent to fix #${caseNumber}: its proposed steps show here as changes to the saved Test Case.`
							: "Once the chat works on a Test Case, the steps the chat agent proposes in Run mode show here. In Explore mode it can propose a new Test Case, shown here to accept."}
					</PanelEmpty>
				</div>
				{hasPreviousVersion && chatId ? (
					<DraftActions chatId={chatId} draft={null} hasPreviousVersion />
				) : null}
			</div>
		);
	}

	const remove: RemoveStep =
		chatId && !removeStep.isPending ? (stepId) => removeStep.mutate({ chatId, stepId }) : null;

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
				{view === "changes" ? (
					<DraftChanges draft={draft} remove={remove} />
				) : (
					<DraftFullTest draft={draft} remove={remove} />
				)}
			</div>
			{chatId ? (
				<DraftActions chatId={chatId} draft={draft} hasPreviousVersion={hasPreviousVersion} />
			) : null}
		</div>
	);
}

/**
 * A new Test Case the chat agent proposed in Explore: its name, why, and its steps. Accept
 * creates it as the chat's case, with these steps as its Case draft; Reject drops it.
 */
function ProposalView({ chatId, proposal }: { chatId: string; proposal: CaseProposal }) {
	const accept = useAcceptAutoProposal();
	const reject = useRejectAutoProposal();
	const busy = accept.isPending || reject.isPending;

	return (
		<div className="flex h-full min-h-0 flex-col gap-3">
			<header className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					<span className="rounded bg-warning-container px-1.5 py-0.5 text-[11px] font-medium text-on-warning-container">
						Proposed
					</span>
					<h3 className="m-0 min-w-0 truncate text-body-sm font-semibold text-on-surface">
						{proposal.name}
					</h3>
					<span className="ml-auto shrink-0 text-helper text-on-surface-variant">
						{proposal.steps.length} {proposal.steps.length === 1 ? "step" : "steps"}
					</span>
				</div>
				{proposal.reason ? (
					<p className="m-0 text-helper text-on-surface-variant">{proposal.reason}</p>
				) : null}
			</header>
			<ol className="m-0 flex min-h-0 flex-1 list-none flex-col gap-2 overflow-y-auto p-0">
				{proposal.steps.map((step, index) => (
					<li
						className="flex gap-3 rounded-lg border border-outline-variant bg-surface-container-low p-3"
						// The proposal is replaced whole, never edited step by step.
						// biome-ignore lint/suspicious/noArrayIndexKey: its steps have no ids
						key={index}
					>
						<span className="shrink-0 text-body-sm font-medium text-outline">{index + 1}</span>
						<StepText step={{ id: String(index), flowId: null, ...step }} />
					</li>
				))}
			</ol>
			<div className="flex shrink-0 flex-col gap-2 border-t border-outline-variant pt-3">
				<p className="m-0 text-helper text-on-surface-variant">
					Accept creates this Test Case on the App as the chat's case. Its steps become the Case
					draft, saved once a Run of it passes and you apply it.
				</p>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						className="h-8 rounded-lg bg-primary px-4 text-body-sm font-semibold text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
						isDisabled={busy}
						onPress={() => accept.mutate(chatId)}
					>
						Accept
					</Button>
					<Button
						className="h-8 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-sm font-semibold text-on-surface shadow-none data-[hovered=true]:bg-surface-container"
						isDisabled={busy}
						onPress={() => reject.mutate(chatId)}
						variant="ghost"
					>
						Reject
					</Button>
				</div>
			</div>
		</div>
	);
}

/**
 * Apply (off, saying why, until a Run of the whole draft passed), Reject all, and Restore
 * previous version once Apply has kept one. With no draft, only Restore.
 */
function DraftActions({
	chatId,
	draft,
	hasPreviousVersion,
}: {
	chatId: string;
	draft: CaseDraft | null;
	hasPreviousVersion: boolean;
}) {
	const runLive = useValue(() => {
		const run = shownAutoChat$.chat.run.get();
		return run ? isRunLive(run) : false;
	});
	const apply = useApplyAutoDraft();
	const reject = useRejectAutoDraft();
	const restore = useRestoreAutoPreviousVersion();
	const busy = apply.isPending || reject.isPending || restore.isPending;
	const blocker = draft ? applyBlocker(draft, runLive) : null;

	return (
		<div className="flex shrink-0 flex-col gap-2 border-t border-outline-variant pt-3">
			{blocker ? <p className="m-0 text-helper text-on-surface-variant">{blocker}</p> : null}
			<div className="flex flex-wrap items-center gap-2">
				{draft ? (
					<>
						<Button
							className="h-8 rounded-lg bg-primary px-4 text-body-sm font-semibold text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
							isDisabled={blocker !== null || busy}
							onPress={() => apply.mutate(chatId)}
						>
							Apply
						</Button>
						<Button
							className="h-8 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-body-sm font-semibold text-on-surface shadow-none data-[hovered=true]:bg-surface-container"
							isDisabled={busy}
							onPress={() => reject.mutate(chatId)}
							variant="ghost"
						>
							Reject all
						</Button>
					</>
				) : null}
				{hasPreviousVersion ? (
					<Button
						className="ml-auto h-8 rounded-lg bg-transparent px-3 text-body-sm font-medium text-primary shadow-none data-[hovered=true]:bg-surface-container"
						isDisabled={busy}
						onPress={() => restore.mutate(chatId)}
						variant="ghost"
					>
						Restore previous version
					</Button>
				) : null}
			</div>
		</div>
	);
}

/** ✕: take a step out of the draft. There is no per-step ✓: Apply takes the whole draft. */
function RemoveStepButton({ number, onRemove }: { number: number; onRemove: () => void }) {
	return (
		<Button
			aria-label={`Remove step ${number} from the draft`}
			className="ml-auto size-6 min-w-6 rounded-md bg-transparent p-0 text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
			onPress={onRemove}
			variant="ghost"
		>
			<svg aria-hidden="true" fill="none" height="12" viewBox="0 0 12 12" width="12">
				<path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
			</svg>
		</Button>
	);
}

function DraftChanges({ draft, remove }: { draft: CaseDraft; remove: RemoveStep }) {
	const rows = draftChangeRows(draft);
	return (
		<ol className="m-0 flex list-none flex-col gap-2 p-0">
			{rows.map((row) => (
				<li key={rowKey(row)}>
					<ChangeRow remove={remove} row={row} />
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

function ChangeRow({ row, remove }: { row: DraftChangeRow; remove: RemoveStep }) {
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
				{row.kind !== "removed" && remove ? (
					<RemoveStepButton number={row.number} onRemove={() => remove(row.after.id)} />
				) : null}
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

function DraftFullTest({ draft, remove }: { draft: CaseDraft; remove: RemoveStep }) {
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
					{remove ? <RemoveStepButton number={index + 1} onRemove={() => remove(step.id)} /> : null}
				</li>
			))}
		</ol>
	);
}
