import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import { useControlAutoRun } from "@/features/auto/hooks/usequery/use-auto";
import {
	isRunLive,
	runCardControls,
	runCardElapsedMs,
	runCardPauseNote,
	runCardProgress,
} from "@/features/auto/utils/run-card";
import { formatRunDuration } from "@/features/runs/utils/labels";
import { Button } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { Link } from "@tanstack/react-router";
import type { AutoRun, AutoRunControl, AutoRunStep } from "@yoqa/runner-client";
import { useEffect } from "react";

const STEP_DOT: Record<AutoRunStep["status"], string> = {
	pending: "bg-outline-variant",
	running: "bg-violet motion-live-dot",
	passed: "bg-secondary",
	failed: "bg-error",
	stopped: "bg-outline",
};

const STATUS_TONE: Record<AutoRun["status"], string> = {
	queued: "text-on-violet-container",
	running: "text-on-violet-container",
	passed: "text-on-secondary-container",
	errored: "text-on-error-container",
	cancelled: "text-on-surface-variant",
};

const CONTROL_LABEL: Record<AutoRunControl, string> = {
	pause: "Pause",
	"take-over": "Take over",
	resume: "Resume",
};

/**
 * The chat's Run of its Case draft: how far it got and for how long, each step with what it
 * ran, and the vision Provider driving it, with Pause, Take over and Resume. The composer's
 * Stop (and Esc) cancels it.
 */
export function AutoRunCard({ run }: { run: AutoRun }) {
	const live = isRunLive(run);
	const now$ = useObservable(Date.now());
	const now = useValue(now$);

	useEffect(() => {
		if (!live) return;
		now$.set(Date.now());
		const timer = setInterval(() => now$.set(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [live, now$]);

	return (
		<section
			aria-label="Run of the Case draft"
			className="flex max-w-[92%] flex-col gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2.5"
		>
			<header className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<span className={`text-body-sm font-semibold ${STATUS_TONE[run.status]}`}>
					{runCardProgress(run)}
				</span>
				<span className="font-mono text-helper text-outline">
					{formatRunDuration(runCardElapsedMs(run, now))}
				</span>
				<Link
					className="ml-auto text-helper font-medium text-primary no-underline hover:underline"
					params={{ runId: run.runId }}
					to="/runs/$runId"
				>
					Open Run
				</Link>
			</header>
			<ol className="m-0 flex list-none flex-col gap-1.5 p-0">
				{run.steps.map((step, index) => (
					<li className="flex gap-2" key={`${index}:${step.instructions}`}>
						<span
							aria-label={step.status}
							className={`mt-1.5 size-1.5 shrink-0 rounded-full ${STEP_DOT[step.status]}`}
						/>
						<span className="flex min-w-0 flex-col gap-0.5">
							<span className="text-body-sm text-on-surface">
								<span className="text-outline">{index + 1}.</span> {step.instructions}
							</span>
							<CommandLines commands={step.commands} />
						</span>
					</li>
				))}
			</ol>
			{run.replayed.length > 0 ? (
				<div className="flex flex-col gap-0.5 border-t border-outline-variant pt-1.5">
					<span className="text-helper text-on-surface-variant">Case Script</span>
					<CommandLines commands={run.replayed} />
				</div>
			) : null}
			{run.error && !live ? (
				<p className="m-0 rounded-lg bg-error-container px-2.5 py-1.5 text-helper text-on-error-container">
					{run.error}
				</p>
			) : null}
			<p className="m-0 text-helper text-outline">
				{run.provider
					? `Driven by ${run.provider}, the app's default vision Provider`
					: run.executionMode === "script"
						? "Replayed with no Provider call"
						: "Driven by the app's default vision Provider"}
			</p>
			<RunControls run={run} />
		</section>
	);
}

/** Pause, Take over and Resume, and where the Run is with them. */
function RunControls({ run }: { run: AutoRun }) {
	const chatId = useValue(shownAutoChat$.chatId);
	const control = useControlAutoRun();
	const controls = runCardControls(run);
	const note = runCardPauseNote(run);
	if (controls.length === 0) return null;

	return (
		<div className="flex flex-col gap-1.5 border-t border-outline-variant pt-2">
			{note ? (
				<output aria-live="polite" className="text-helper text-on-surface-variant">
					{note}
				</output>
			) : null}
			<div className="flex flex-wrap items-center gap-2">
				{controls.map((item) => (
					<Button
						className={
							item === "resume"
								? "h-7 rounded-lg bg-primary px-3 text-helper font-semibold text-on-primary data-[hovered=true]:bg-primary/90"
								: "h-7 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-helper font-semibold text-on-surface shadow-none data-[hovered=true]:bg-surface-container"
						}
						isDisabled={!chatId || control.isPending}
						key={item}
						onPress={() => {
							if (chatId) control.mutate({ chatId, control: item });
						}}
						variant={item === "resume" ? undefined : "ghost"}
					>
						{CONTROL_LABEL[item]}
					</Button>
				))}
			</div>
		</div>
	);
}

/** The command line of each Action, in order. */
function CommandLines({ commands }: { commands: string[] }) {
	return commands.map((command, index) => (
		<code
			className="truncate font-mono text-[11px] text-on-surface-variant"
			key={`${index}:${command}`}
			title={command}
		>
			{command}
		</code>
	));
}
