import { useObservable, useValue } from "@legendapp/state/react";
import {
	type RunStep,
	formatStepCommand,
	readStepCycle,
	actionSummary as reportActionSummary,
	stepReasoning as reportStepReasoning,
} from "@yoqa/runner-client";

export const STEP_ROW =
	"grid grid-cols-[24px_minmax(0,1fr)] gap-3.5 border-t border-outline-variant py-3.5 first:border-t-transparent";

function actionSummary(action: unknown): string {
	return reportActionSummary(action);
}

function stepCommandText(step: RunStep): string | null {
	return step.command ?? formatStepCommand(step.action);
}

function StepCommand({ command }: { command: string | null }) {
	if (!command) return null;
	return (
		<code
			className="max-w-full min-w-0 shrink truncate rounded-md border border-outline-variant bg-surface-container px-2 py-0.5 font-mono text-xs text-on-surface-variant"
			title={command}
		>
			{command}
		</code>
	);
}

function stepReasoning(step: RunStep): { reason: string | null; thoughts: string | null } {
	return reportStepReasoning(step);
}

function verifyLabel(type: string): string {
	if (type === "verify") return "Passed";
	if (type === "fail") return "Failed";
	return "Not yet";
}

function StepCycle({ action }: { action: unknown }) {
	const cycle = readStepCycle(action);
	if (!cycle) return null;
	const decision = cycle.decision ? actionSummary(cycle.decision) : "—";
	const decisionReason =
		typeof cycle.decision?.reason === "string" && cycle.decision.reason.trim()
			? cycle.decision.reason.trim()
			: null;
	const verifyTone =
		cycle.verify.type === "verify" ? "passed" : cycle.verify.type === "fail" ? "failed" : "pending";
	const verifyText = cycle.verify.reason
		? `${verifyLabel(cycle.verify.type)} — ${cycle.verify.reason}`
		: verifyLabel(cycle.verify.type);
	const verifyClass =
		verifyTone === "passed"
			? "text-on-secondary-container"
			: verifyTone === "failed"
				? "text-error"
				: "text-outline";
	const decisionText = decisionReason || decision;

	return (
		<div className="flex flex-col gap-1.5 text-[13px] leading-normal text-on-surface/80">
			<div className="flex gap-3">
				<span className="w-16 shrink-0 pt-0.5 text-[11px] font-medium tracking-[0.06em] text-outline uppercase">
					Decision
				</span>
				<span>{decisionText}</span>
			</div>
			<div className="flex gap-3">
				<span className="w-16 shrink-0 pt-0.5 text-[11px] font-medium tracking-[0.06em] text-outline uppercase">
					Verify
				</span>
				<span className={verifyClass}>{verifyText}</span>
			</div>
		</div>
	);
}

function StepAiThoughts({ reason, thoughts }: { reason: string | null; thoughts: string | null }) {
	const open$ = useObservable(false);
	const open = useValue(open$);
	if (!reason && !thoughts) return null;

	const canExpand = Boolean(thoughts);

	return (
		<div className="mt-1.5">
			{reason ? <p className="text-body-sm text-on-surface-variant">{reason}</p> : null}
			{canExpand ? (
				<>
					<button
						aria-expanded={open}
						className="inline-flex items-center gap-1 text-xs text-outline transition-colors hover:text-on-surface"
						onClick={() => open$.set((value) => !value)}
						type="button"
					>
						<svg
							aria-hidden="true"
							className={[
								"size-3.5 transition-transform duration-[var(--motion-fast)]",
								open ? "rotate-90" : "",
							].join(" ")}
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							viewBox="0 0 24 24"
						>
							<path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						{open ? "Hide AI thoughts" : "AI thoughts"}
					</button>
					{open ? (
						<p className="mt-1.5 rounded-lg bg-surface-container/70 px-3 py-2 text-body-sm leading-relaxed text-on-surface-variant">
							{thoughts}
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
}

export function StepNumber({
	index,
	ok,
}: {
	index: number | null;
	ok: boolean | null;
}) {
	const tone =
		ok === null
			? "bg-surface-container text-outline"
			: ok
				? "bg-secondary/15 text-on-secondary-container"
				: "bg-error/15 text-on-error-container";
	return (
		<span
			className={[
				"flex size-[22px] items-center justify-center rounded-full font-mono text-[11px] font-semibold",
				tone,
			].join(" ")}
		>
			{index ?? "…"}
		</span>
	);
}

function StepOutcome({ ok }: { ok: boolean }) {
	return (
		<span className={["text-xs", ok ? "text-on-secondary-container" : "text-error"].join(" ")}>
			{ok ? "Passed" : "Failed"}
		</span>
	);
}

export function StepRow({
	step,
	index,
	selected,
	arriving,
	onSelect,
}: {
	step: RunStep;
	index: number;
	selected: boolean;
	arriving: boolean;
	onSelect: (() => void) | null;
}) {
	const { reason, thoughts } = stepReasoning(step);
	const cycle = readStepCycle(step.action);
	const showThoughts = Boolean(cycle ? thoughts : reason || thoughts);
	const heading = (
		<div className="flex min-w-0 flex-wrap items-center gap-2.5">
			<span className="text-sm font-semibold">{actionSummary(step.action)}</span>
			<StepCommand command={stepCommandText(step)} />
			<span className="min-w-2 flex-1" />
			<StepOutcome ok={step.ok} />
		</div>
	);
	const body = (
		<>
			<StepNumber index={index} ok={step.ok} />
			<div className="flex min-w-0 flex-col gap-2">
				{heading}
				<StepCycle action={step.action} />
			</div>
		</>
	);

	return (
		<li className={[STEP_ROW, arriving ? "motion-step-in" : ""].join(" ")}>
			{onSelect ? (
				<button
					aria-current={selected ? "step" : undefined}
					className="col-span-2 grid grid-cols-subgrid rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
					onClick={onSelect}
					type="button"
				>
					{body}
				</button>
			) : (
				body
			)}
			{showThoughts ? (
				<div className="col-start-2 row-start-2">
					<StepAiThoughts reason={cycle ? null : reason} thoughts={thoughts} />
				</div>
			) : null}
		</li>
	);
}

export function InProgressStepRow({ command }: { command?: string | null }) {
	return (
		<li className={STEP_ROW}>
			<StepNumber index={null} ok={null} />
			<div className="flex min-w-0 flex-wrap items-center gap-2.5">
				{command ? (
					<StepCommand command={command} />
				) : (
					<span className="text-sm text-on-surface-variant">In progress…</span>
				)}
				<span className="ml-auto inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
					<span className="motion-live-dot size-1.5 rounded-full bg-violet" />
					Executing…
				</span>
			</div>
		</li>
	);
}
