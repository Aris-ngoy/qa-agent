import { buildScriptStepsView, runProgress } from "@/features/inspector/script-steps";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

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
	passed: "text-on-secondary-container",
	running: "text-on-violet-container",
	queued: "text-on-surface-variant",
	idle: "text-on-surface-variant",
} as const;

const ICON_BTN =
	"inline-flex size-10 items-center justify-center rounded-[10px] border border-outline-variant bg-surface-bright text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50";
const TEXT_BTN =
	"inline-flex min-h-10 items-center gap-1.5 rounded-[10px] border border-outline-variant bg-surface-bright px-3 text-body-md font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50";

function ButtonIcon({
	children,
	className = "size-4",
}: { children: ReactNode; className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			{children}
		</svg>
	);
}

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
	const stepCount = stepsView.steps.length;
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
		"min-h-10 w-full rounded-lg px-3 text-left text-body-md text-on-surface hover:bg-violet-container disabled:opacity-50";

	return (
		<section
			aria-labelledby="inspector-script-heading"
			className="flex min-w-0 flex-col rounded-[18px] border border-outline-variant bg-surface-bright"
		>
			<div className="flex flex-wrap items-center justify-between gap-3 border-b border-outline-variant px-4 py-3.5">
				<div className="flex items-center gap-3">
					<h2 id="inspector-script-heading" className="m-0 text-subheading text-on-surface">
						Script
					</h2>
					<fieldset
						aria-label="Script view"
						className="m-0 flex min-w-0 gap-0.5 rounded-lg border-0 bg-surface-container p-[3px]"
					>
						{(["steps", "code"] as const).map((option) => (
							<button
								key={option}
								type="button"
								aria-pressed={view === option}
								className={[
									"min-h-8 rounded-md px-3 text-body-sm font-semibold transition-colors",
									view === option
										? "bg-surface-bright text-on-surface shadow-[0_1px_2px_rgba(27,26,34,0.12)]"
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
					<button
						type="button"
						className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-error px-4 text-body-md font-semibold text-on-error"
						onClick={onStop}
					>
						<ButtonIcon className="size-3.5">
							<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" />
						</ButtonIcon>
						Stop
					</button>
				) : (
					<button
						type="button"
						disabled={!canRun}
						className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-primary px-4 text-body-md font-semibold text-on-primary transition-opacity disabled:opacity-50"
						onClick={onRun}
					>
						<svg aria-hidden="true" className="size-3.5" fill="currentColor" viewBox="0 0 24 24">
							<path d="M6 3l15 9-15 9z" />
						</svg>
						Run script
					</button>
				)}
			</div>

			{running ? (
				<div className="flex flex-col gap-1.5 px-4 pt-3">
					<div className="flex items-center justify-between text-body-sm">
						<span className="font-semibold text-on-surface">
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
					<p className="m-3 rounded-xl bg-surface-container px-3 py-6 text-center text-body-sm text-on-surface-variant">
						No steps yet. Select an element on the device, or write commands in the Code tab.
					</p>
				) : (
					<ol className="m-0 flex max-h-140 list-none flex-col gap-0.5 overflow-auto px-2 pt-3 pb-2">
						{stepsView.steps.map((step) => (
							<li key={step.lineNumber}>
								{(groupsByLine.get(step.lineNumber) ?? []).map((text) => (
									<div
										key={text}
										className="px-2 pt-3 pb-1 text-label-caps uppercase text-on-surface-variant"
									>
										{text}
									</div>
								))}
								<div
									className={[
										"flex min-h-11 items-center gap-3 rounded-[10px] px-2 text-body-md transition-colors",
										step.status === "running"
											? "bg-violet-container/60"
											: "hover:bg-surface-container-low",
									].join(" ")}
								>
									<span className="w-5.5 shrink-0 text-right font-mono text-helper text-on-surface-variant">
										{step.index}
									</span>
									<span
										className={[
											"shrink-0 rounded-md px-2 py-0.5 text-helper font-semibold",
											step.verb.toLowerCase().startsWith("assert")
												? "bg-sky-100 text-sky-900"
												: "bg-violet-container text-on-violet-container",
										].join(" ")}
									>
										{step.verb}
									</span>
									<span className="min-w-0 flex-1 truncate text-on-surface">{step.text}</span>
									<span className="shrink-0 font-mono text-helper text-on-surface-variant">
										{step.meta}
									</span>
									<span
										className={[
											"inline-flex w-[4.5rem] shrink-0 items-center justify-end gap-1 text-helper font-semibold",
											STATUS_TONE[step.status],
										].join(" ")}
									>
										{step.status === "passed" ? (
											<ButtonIcon className="size-3.5">
												<path d="M5 12l5 5 9-10" />
											</ButtonIcon>
										) : null}
										{step.status === "running" ? (
											<ButtonIcon className="size-3.5 animate-spin">
												<path d="M12 3a9 9 0 1 0 9 9" />
											</ButtonIcon>
										) : null}
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
					className="mx-4 mt-3 mb-2 min-h-72 resize-y rounded-xl border-0 bg-[#17161d] px-3.5 py-3 font-mono text-body-sm leading-[1.8] text-[#e6e3f0] outline-none focus-visible:ring-2 focus-visible:ring-violet disabled:opacity-60"
					disabled={editingDisabled}
					rows={14}
					spellCheck={false}
					value={script}
					onChange={(event) => onScriptChange(event.target.value)}
				/>
			)}

			{stepsView.errors.length > 0 ? (
				<p className="m-0 px-4 pb-2 text-helper text-error">
					{stepsView.errors.length} line{stepsView.errors.length === 1 ? "" : "s"} can’t be parsed
					(first: L{stepsView.errors[0]?.lineNumber}). Fix in the Code tab.
				</p>
			) : null}

			<div
				aria-live="polite"
				className="mx-4 mb-3 max-h-40 min-h-16 overflow-auto rounded-xl bg-surface-container px-3 py-2 font-mono text-helper leading-relaxed"
			>
				{log.length === 0 ? (
					<p className="m-0 text-on-surface-variant">Run log will appear here.</p>
				) : (
					<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
						{log.map((entry) => (
							<li
								key={entry.id}
								className={
									entry.tone === "error"
										? "text-error"
										: entry.tone === "ok"
											? "text-on-secondary-container"
											: "text-on-surface-variant"
								}
							>
								{entry.text}
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-outline-variant px-4 pt-3 pb-4">
				<span className="text-body-sm text-on-surface-variant">
					{stepCount === 0 ? "No steps yet" : `${stepCount} step${stepCount === 1 ? "" : "s"}`}
				</span>
				<div className="flex gap-2">
					<button
						type="button"
						aria-label="Copy script"
						title="Copy script"
						className={ICON_BTN}
						disabled={running}
						onClick={onCopy}
					>
						<ButtonIcon>
							<rect x="9" y="9" width="12" height="12" rx="2" />
							<path d="M5 15V5a2 2 0 0 1 2-2h8" />
						</ButtonIcon>
					</button>
					<div ref={exportRef} className="relative">
						<button
							type="button"
							className={TEXT_BTN}
							disabled={running}
							aria-haspopup="menu"
							aria-expanded={exportOpen}
							onClick={() => setExportOpen((open) => !open)}
						>
							<ButtonIcon>
								<path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
							</ButtonIcon>
							{exportingReport ? "Exporting…" : "Export"}
							<ButtonIcon className="size-3.5">
								<path d="M7 10l5 5 5-5" />
							</ButtonIcon>
						</button>
						{exportOpen ? (
							<div
								role="menu"
								className="absolute right-0 bottom-full z-30 mb-1 flex min-w-44 flex-col rounded-xl border border-outline-variant bg-surface-bright p-1.5 shadow-[0_12px_32px_rgba(27,26,34,0.14)]"
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
					<button
						type="button"
						disabled={running || !canSaveAsCase}
						className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-violet px-4 text-body-md font-semibold text-on-violet transition-opacity disabled:opacity-50"
						onClick={onSaveAsCase}
					>
						<ButtonIcon>
							<path d="M5 3h11l3 3v15H5z" />
							<path d="M8 3v5h7V3M8 21v-7h8v7" />
						</ButtonIcon>
						Save as test case
					</button>
				</div>
			</div>
		</section>
	);
}
