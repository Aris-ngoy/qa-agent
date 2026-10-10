import { buildScriptStepsView, runProgress } from "@/features/inspector/script-steps";
import { Button } from "@heroui/react";
import { useEffect, useMemo, useRef, useState } from "react";

export type RunLogEntry = {
	id: string;
	text: string;
	tone: "info" | "ok" | "error";
};

type ScriptPanelProps = {
	script: string;
	onScriptChange: (value: string) => void;
	/** Editing is locked while a Run is in flight. */
	editingDisabled: boolean;
	activeLineNumber: number | null;
	running: boolean;
	canRun: boolean;
	canSaveAsCase: boolean;
	canExportReport: boolean;
	exportingReport: boolean;
	log: RunLogEntry[];
	onRun: () => void;
	onStop: () => void;
	onCopy: () => void;
	onExport: () => void;
	onExportReportHtml: () => void;
	onExportReportMarkdown: () => void;
	onSaveAsCase: () => void;
};

type ScriptView = "steps" | "code";

const STATUS_LABEL = { passed: "Passed", running: "Running", queued: "Queued", idle: "" } as const;
const STATUS_TONE = {
	passed: "text-secondary",
	running: "text-secondary font-semibold",
	queued: "text-on-surface-variant",
	idle: "text-on-surface-variant",
} as const;

export function ScriptPanel({
	script,
	onScriptChange,
	editingDisabled,
	activeLineNumber,
	running,
	canRun,
	canSaveAsCase,
	canExportReport,
	exportingReport,
	log,
	onRun,
	onStop,
	onCopy,
	onExport,
	onExportReportHtml,
	onExportReportMarkdown,
	onSaveAsCase,
}: ScriptPanelProps) {
	const [view, setView] = useState<ScriptView>("steps");
	const [exportOpen, setExportOpen] = useState(false);
	const exportRef = useRef<HTMLDivElement | null>(null);

	const stepsView = useMemo(
		() => buildScriptStepsView(script, activeLineNumber, running),
		[script, activeLineNumber, running],
	);
	const progress = runProgress(stepsView);
	const failed = log.filter((entry) => entry.tone === "error").length;

	useEffect(() => {
		if (!exportOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!exportRef.current?.contains(event.target as Node)) setExportOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setExportOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [exportOpen]);

	const groupsByLine = new Map<number, string[]>();
	for (const group of stepsView.groups) {
		const next = stepsView.steps.find((step) => step.lineNumber > group.beforeLineNumber);
		if (!next) continue;
		groupsByLine.set(next.lineNumber, [...(groupsByLine.get(next.lineNumber) ?? []), group.text]);
	}

	const exportDisabled = running || exportingReport;
	const menuItem =
		"w-full px-3 py-2 text-left text-body-sm text-on-surface hover:bg-surface-container disabled:opacity-50";

	return (
		<section
			aria-labelledby="inspector-script-heading"
			className="flex min-w-0 flex-col gap-3 rounded-xl border border-outline-variant/30 bg-surface-container/40 p-3"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-3">
					<h2 id="inspector-script-heading" className="text-title-sm font-semibold text-on-surface">
						Script
					</h2>
					<fieldset
						aria-label="Script view"
						className="m-0 inline-flex min-w-0 rounded-lg border-0 bg-surface-container p-0.5"
					>
						{(["steps", "code"] as const).map((option) => (
							<button
								key={option}
								type="button"
								aria-pressed={view === option}
								className={[
									"rounded-md px-2.5 py-1 text-body-sm font-medium transition-colors",
									view === option
										? "bg-surface text-on-surface shadow-sm"
										: "text-on-surface-variant hover:text-on-surface",
								].join(" ")}
								onClick={() => setView(option)}
							>
								{option === "steps" ? "Steps" : "Code"}
							</button>
						))}
					</fieldset>
				</div>
				{running ? (
					<Button size="sm" variant="danger" onPress={onStop}>
						Stop
					</Button>
				) : (
					<Button size="sm" variant="primary" isDisabled={!canRun} onPress={onRun}>
						Run script
					</Button>
				)}
			</div>

			{running ? (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between text-helper">
						<span className="font-medium text-on-surface">
							{progress.currentIndex != null
								? `Running · step ${progress.currentIndex} of ${progress.total}`
								: "Running…"}
						</span>
						<span className="text-on-surface-variant">
							{progress.passed} passed · {failed} failed
						</span>
					</div>
					<progress
						aria-label="Run progress"
						max={progress.total}
						value={progress.passed}
						className="h-1.5 w-full overflow-hidden rounded-full [&::-moz-progress-bar]:bg-secondary [&::-webkit-progress-bar]:bg-surface-container [&::-webkit-progress-value]:bg-secondary"
					/>
				</div>
			) : null}

			{view === "steps" ? (
				stepsView.steps.length === 0 ? (
					<p className="rounded-lg bg-surface-container px-3 py-6 text-center text-body-sm text-on-surface-variant">
						No steps yet. Select an element on the device, or write commands in the Code tab.
					</p>
				) : (
					<ol className="flex max-h-[28rem] flex-col overflow-auto">
						{stepsView.steps.map((step) => (
							<li key={step.lineNumber}>
								{(groupsByLine.get(step.lineNumber) ?? []).map((text) => (
									<div
										key={text}
										className="px-2 pt-2 pb-1 text-helper font-semibold text-on-surface-variant"
									>
										{text}
									</div>
								))}
								<div
									className={[
										"flex items-center gap-2 rounded-lg px-2 py-1.5 text-body-sm",
										step.status === "running" ? "bg-secondary-container/50" : "",
									].join(" ")}
								>
									<span className="w-6 shrink-0 text-right font-mono text-helper text-on-surface-variant">
										{step.index}
									</span>
									<span className="shrink-0 rounded-md bg-surface-container px-1.5 py-0.5 text-helper font-semibold text-on-surface">
										{step.verb}
									</span>
									<span className="min-w-0 flex-1 truncate text-on-surface">{step.text}</span>
									<span className="shrink-0 font-mono text-helper text-on-surface-variant">
										{step.meta}
									</span>
									<span
										className={[
											"w-14 shrink-0 text-right text-helper",
											STATUS_TONE[step.status],
										].join(" ")}
									>
										{STATUS_LABEL[step.status]}
									</span>
								</div>
							</li>
						))}
					</ol>
				)
			) : (
				<textarea
					aria-label="Yoqa shell script"
					className="min-h-72 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container px-3 py-2.5 font-mono text-body-sm leading-relaxed text-on-surface outline-none transition-colors focus:border-secondary disabled:opacity-60"
					disabled={editingDisabled}
					rows={14}
					spellCheck={false}
					value={script}
					onChange={(event) => onScriptChange(event.target.value)}
				/>
			)}

			{stepsView.errors.length > 0 ? (
				<p className="text-helper text-error">
					{stepsView.errors.length} line{stepsView.errors.length === 1 ? "" : "s"} can’t be parsed
					(first: L{stepsView.errors[0]?.lineNumber}). Fix in the Code tab.
				</p>
			) : null}

			<div
				aria-live="polite"
				className="max-h-40 min-h-16 overflow-auto rounded-lg bg-surface-container px-3 py-2 font-mono text-helper leading-relaxed"
			>
				{log.length === 0 ? (
					<p className="text-on-surface-variant">Run log will appear here.</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{log.map((entry) => (
							<li
								key={entry.id}
								className={
									entry.tone === "error"
										? "text-error"
										: entry.tone === "ok"
											? "text-secondary"
											: "text-on-surface-variant"
								}
							>
								{entry.text}
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="flex items-center justify-end gap-1.5 border-t border-outline-variant/30 pt-3">
				<Button size="sm" variant="secondary" isDisabled={running} onPress={onCopy}>
					Copy
				</Button>
				<div ref={exportRef} className="relative">
					<Button
						size="sm"
						variant="secondary"
						isDisabled={running}
						aria-haspopup="menu"
						aria-expanded={exportOpen}
						onPress={() => setExportOpen((open) => !open)}
					>
						{exportingReport ? "Exporting…" : "Export ▾"}
					</Button>
					{exportOpen ? (
						<div
							role="menu"
							className="absolute right-0 bottom-full z-30 mb-1 w-44 overflow-hidden rounded-xl border border-outline-variant/40 bg-surface py-1 shadow-lg"
						>
							<button
								type="button"
								role="menuitem"
								className={menuItem}
								onClick={() => {
									setExportOpen(false);
									onExport();
								}}
							>
								Shell script (.sh)
							</button>
							<button
								type="button"
								role="menuitem"
								disabled={exportDisabled || !canExportReport}
								className={menuItem}
								onClick={() => {
									setExportOpen(false);
									onExportReportHtml();
								}}
							>
								HTML report
							</button>
							<button
								type="button"
								role="menuitem"
								disabled={exportDisabled || !canExportReport}
								className={menuItem}
								onClick={() => {
									setExportOpen(false);
									onExportReportMarkdown();
								}}
							>
								Markdown report
							</button>
						</div>
					) : null}
				</div>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={running || !canSaveAsCase}
					onPress={onSaveAsCase}
				>
					Save as test case
				</Button>
			</div>
		</section>
	);
}
