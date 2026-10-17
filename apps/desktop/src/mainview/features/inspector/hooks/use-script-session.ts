import { showErrorToast } from "@/app/show-error-toast";
import type { Application } from "@/features/apps/hooks/use-apps";
import { readScreenshotBytes } from "@/features/inspector/data/api/screen";
import { runInspectorCaseScript } from "@/features/inspector/data/api/script";
import type { InspectorFeedController } from "@/features/inspector/data/state/feed";
import {
	type InspectorScript$,
	type RunLogEntry,
	appendScript,
	beginRun,
	finishRun,
	initialScriptState,
	pushLog,
} from "@/features/inspector/data/state/script";
import { useSaveTestCase } from "@/features/inspector/hooks/usequery/use-save-test-case";
import { tapLinesForSelection } from "@/features/inspector/utils/command-snippets";
import {
	bytesToBase64,
	downloadTextFile,
	exportRunReport,
	notify,
} from "@/features/inspector/utils/report";
import {
	caseScriptLinesFromShell,
	defaultCaseNameFromScript,
	scriptHasBody,
	swipeLines,
	waitLine,
} from "@/features/inspector/utils/script-text";
import type { InspectorSelection } from "@/features/inspector/utils/selection";
import { errorMessage, settle } from "@/features/inspector/utils/settle";
import { useObservable } from "@legendapp/state/react";
import { useNavigate } from "@tanstack/react-router";
import {
	CASE_SCRIPT_FILE_EXTENSION,
	type CaseScript,
	buildRunReportFromInspectorSession,
	caseScriptActionCommand,
	formatCaseScriptFileAction,
	formatCaseScriptFileErrors,
	formatCaseScriptShell,
	looksLikeShellScript,
	parseCaseScriptFile,
	suggestedScriptBasename,
	toCaseScriptFileText,
} from "@yoqa/runner-client";
import { useEffect, useRef } from "react";

type InspectorReportStep = {
	index: number;
	summary: string;
	ok: boolean;
	latencyMs: number | null;
	detail: string | null;
	command: string | null;
	screenshotBase64: string | null;
};

type ScriptSessionOptions = {
	controller: InspectorFeedController;
	selectedApp: Application | null;
};

/** Case Script file text, run log, and save-as-case. State lives on `script$` for this page visit. */
export function useScriptSession({ controller, selectedApp }: ScriptSessionOptions) {
	const script$ = useObservable(initialScriptState());
	const navigate = useNavigate();
	const saveCase = useSaveTestCase();
	const abortRef = useRef<AbortController | null>(null);
	const logIdRef = useRef(0);
	const feed$ = controller.feed$;

	useEffect(() => {
		return () => {
			abortRef.current?.abort();
		};
	}, []);

	const nextLogId = () => {
		logIdRef.current += 1;
		return String(logIdRef.current);
	};

	const log = (text: string, tone: RunLogEntry["tone"] = "info") => {
		pushLog(script$, { id: nextLogId(), text, tone });
	};

	const logWarnings = (warnings: string[]) => {
		for (const warning of warnings) log(`⚠ ${warning}`);
	};

	/** The dialog and recorder speak `yoqa` shell; the editor holds a Case Script file. */
	const appendShellLines = (lines: string[]) => {
		const converted = caseScriptLinesFromShell(lines, feed$.elements.peek());
		logWarnings(converted.warnings);
		if (converted.lines.length > 0) appendScript(script$, converted.lines);
		return converted;
	};

	const handleDoubleTap = (next: InspectorSelection) => {
		controller.select(next);
		appendShellLines(tapLinesForSelection(next));
	};

	const handleAddSwipe = (direction: "up" | "down" | "left" | "right") => {
		appendScript(script$, swipeLines(direction));
	};

	const handleAddWait = (seconds: number) => {
		appendScript(script$, [waitLine(seconds)]);
	};

	const handleInsertLines = (lines: string[]) => {
		if (lines.length === 0) return;
		if (appendShellLines(lines).actions.length > 0) notify("Inserted");
	};

	const handleCopyLines = (lines: string[]) => {
		if (lines.length === 0) return;
		navigator.clipboard.writeText(lines.join("\n")).then(
			() => notify("Copied command"),
			(error: unknown) => showErrorToast(error, "Failed to copy"),
		);
	};

	const runActions = async (script: CaseScript, options: { resetLog: boolean; label: string }) => {
		const active = feed$.active.peek();
		if (!active || script$.running.peek() || script.actions.length === 0) return;
		const aborter = new AbortController();
		abortRef.current = aborter;
		beginRun(script$, {
			resetLog: options.resetLog,
			clearReport: false,
			entry: { id: nextLogId(), text: options.label, tone: "info" },
		});
		const outcome = await settle(() =>
			runInspectorCaseScript(script, {
				signal: aborter.signal,
				pauseAfterActionMs: 200,
				onStep: ({ action, status, error }) => {
					const line = formatCaseScriptFileAction(action);
					if (status === "running") log(`→ ${line}`);
					else if (status === "ok") log(`✓ ${line}`, "ok");
					else if (status === "error") log(`✗ ${line}: ${error ?? "failed"}`, "error");
				},
			}),
		);
		if (!outcome.ok) {
			log(errorMessage(outcome.error), "error");
			showErrorToast(outcome.error, "Command failed");
		} else if (outcome.value.ok) {
			log(`Done · ${outcome.value.completed}/${outcome.value.total} steps`, "ok");
			notify("Command finished");
		} else {
			log(outcome.value.error ?? "Command failed", "error");
			if (outcome.value.error !== "Aborted") {
				showErrorToast(outcome.value.error ?? "Command failed", "Command failed");
			}
		}
		finishRun(script$);
		abortRef.current = null;
		void controller.refreshTree({ silent: true });
	};

	const handleInsertAndRunLines = (lines: string[]) => {
		if (lines.length === 0) return;
		const { actions } = appendShellLines(lines);
		if (actions.length === 0) return;
		void runActions(
			{ version: 1, savedAt: Date.now(), actions },
			{ resetLog: false, label: "Insert & Run…" },
		);
	};

	const handleRun = async () => {
		const active = feed$.active.peek();
		if (!active || script$.running.peek()) return;
		const text = script$.text.peek();
		const parsed = parseCaseScriptFile(text);
		if (!parsed.ok) {
			const message = formatCaseScriptFileErrors(parsed.errors);
			log(message, "error");
			showErrorToast(new Error(message), "Fix the script first");
			return;
		}
		const aborter = new AbortController();
		abortRef.current = aborter;
		beginRun(script$, {
			resetLog: true,
			clearReport: true,
			entry: { id: nextLogId(), text: "Starting script…", tone: "info" },
		});
		const startedAt = Date.now();
		const reportSteps: InspectorReportStep[] = [];
		let stepStartedAt = startedAt;
		const outcome = await settle(() =>
			runInspectorCaseScript(parsed.script, {
				signal: aborter.signal,
				pauseAfterActionMs: 200,
				onStep: async ({ index, action, status, error }) => {
					const lineNumber = parsed.actionLines[index] ?? null;
					const summary = formatCaseScriptFileAction(action);
					if (status === "skipped") return;
					script$.activeLineNumber.set(lineNumber);
					if (status === "running") {
						stepStartedAt = Date.now();
						log(`→ L${lineNumber} ${summary}`);
						return;
					}
					const bytes = await readScreenshotBytes().catch(() => null);
					const ok = status === "ok";
					reportSteps.push({
						index: index + 1,
						summary,
						ok,
						latencyMs: Math.max(0, Date.now() - stepStartedAt),
						detail: ok ? null : (error ?? "failed"),
						command: caseScriptActionCommand(action),
						screenshotBase64: bytes ? bytesToBase64(bytes) : null,
					});
					if (ok) {
						log(`✓ L${lineNumber}`, "ok");
					} else {
						log(`✗ L${lineNumber}: ${error ?? "failed"}`, "error");
					}
				},
			}),
		);
		const result = outcome.ok
			? outcome.value
			: { ok: false as const, completed: 0, total: 0, error: errorMessage(outcome.error) };
		const failedLine =
			outcome.ok && result.ok === false && "failedIndex" in result && result.failedIndex != null
				? parsed.actionLines[result.failedIndex]
				: undefined;
		const resultError =
			result.ok || result.error === "Aborted" || failedLine == null
				? result.error
				: `Line ${failedLine}: ${result.error}`;
		script$.report.set(
			buildRunReportFromInspectorSession({
				title: defaultCaseNameFromScript(text),
				appLabel: selectedApp?.name ?? null,
				deviceLabel: active.deviceId,
				platform: active.platform,
				ok: result.ok,
				cancelled: outcome.ok && result.error === "Aborted",
				error: result.ok ? null : (resultError ?? "Script failed"),
				startedAt,
				finishedAt: Date.now(),
				steps: reportSteps,
			}),
		);
		if (!outcome.ok) {
			log(errorMessage(outcome.error), "error");
			showErrorToast(outcome.error, "Script failed");
		} else if (result.ok) {
			log(`Done · ${result.completed}/${result.total} steps`, "ok");
			notify("Script finished");
		} else {
			log(resultError ?? "Script failed", "error");
			if (result.error !== "Aborted") {
				showErrorToast(resultError ?? "Script failed", "Script failed");
			}
		}
		finishRun(script$);
		abortRef.current = null;
		void controller.refreshTree({ silent: true });
	};

	const handleStop = () => {
		abortRef.current?.abort();
	};

	const handleCopy = () => {
		navigator.clipboard.writeText(script$.text.peek()).then(
			() => notify("Copied script"),
			(error: unknown) => showErrorToast(error, "Failed to copy script"),
		);
	};

	const exportBasename = () =>
		suggestedScriptBasename({
			caseName: defaultCaseNameFromScript(script$.text.peek()),
		});

	const handleExport = () => {
		downloadTextFile(
			`${exportBasename()}${CASE_SCRIPT_FILE_EXTENSION}`,
			script$.text.peek(),
			"application/yaml",
		);
	};

	const handleExportShell = () => {
		const text = script$.text.peek();
		const parsed = parseCaseScriptFile(text);
		if (!parsed.ok) {
			showErrorToast(new Error(formatCaseScriptFileErrors(parsed.errors)), "Fix the script first");
			return;
		}
		downloadTextFile(
			`${exportBasename()}.sh`,
			formatCaseScriptShell(parsed.script, { caseName: defaultCaseNameFromScript(text) }),
			"text/x-shellscript",
		);
	};

	const handleExportReport = (format: "html" | "md") => {
		const report = script$.report.peek();
		if (!report) return;
		script$.exportingReport.set(true);
		exportRunReport(report, format);
		script$.exportingReport.set(false);
	};

	/** Load a Case Script file (or legacy JSON / shell) into the editor, replacing it. */
	const handleOpenFile = (text: string, fileName: string) => {
		const converted = toCaseScriptFileText(text, { elements: feed$.elements.peek() });
		if (!converted.text) {
			showErrorToast(
				new Error(formatCaseScriptFileErrors(converted.errors)),
				`Can’t open ${fileName}`,
			);
			return;
		}
		script$.text.set(converted.text);
		logWarnings(converted.warnings);
		notify(`Opened ${fileName}`);
	};

	/**
	 * Pasting a legacy `yoqa` shell script converts it to Case Script actions once.
	 * Returns false for anything else, so the editor pastes it as typed.
	 */
	const handlePasteText = (text: string): boolean => {
		if (!looksLikeShellScript(text)) return false;
		const converted = appendShellLines(text.split(/\r?\n/));
		if (converted.actions.length > 0) {
			notify(
				`Converted ${converted.actions.length} shell line${converted.actions.length === 1 ? "" : "s"}`,
			);
		}
		return true;
	};

	const openSaveAsCase = () => {
		script$.saveError.set(null);
		if (!selectedApp) {
			showErrorToast(new Error("Select an app first"), "Select an app");
			return;
		}
		const parsed = parseCaseScriptFile(script$.text.peek());
		if (!parsed.ok) {
			showErrorToast(
				new Error(
					scriptHasBody(script$.text.peek())
						? formatCaseScriptFileErrors(parsed.errors)
						: "Add actions to the script first",
				),
				"Nothing to save",
			);
			return;
		}
		script$.saveOpen.set(true);
	};

	const handleSaveAsCase = async (name: string) => {
		if (!selectedApp) {
			script$.saveError.set("Select an app first");
			return;
		}
		const parsed = parseCaseScriptFile(script$.text.peek(), { savedAt: Date.now() });
		if (!parsed.ok) {
			script$.saveError.set(formatCaseScriptFileErrors(parsed.errors));
			return;
		}
		const caseScript = parsed.script;
		script$.saving.set(true);
		script$.saveError.set(null);
		const appId = selectedApp.id;
		const outcome = await settle(() => saveCase.mutateAsync({ appId, name, script: caseScript }));
		if (outcome.ok) {
			const mapped = outcome.value;
			script$.saveOpen.set(false);
			notify(`Saved as #${mapped.number} ${mapped.name}`);
			void navigate({ to: "/test-cases/$caseId", params: { caseId: mapped.id } });
		} else {
			script$.saveError.set(errorMessage(outcome.error));
			showErrorToast(outcome.error, "Failed to create test case");
		}
		script$.saving.set(false);
	};

	const setSaveOpen = (open: boolean) => {
		script$.saveOpen.set(open);
		if (!open) script$.saveError.set(null);
	};

	return {
		script$,
		handleDoubleTap,
		handleAddSwipe,
		handleAddWait,
		handleInsertLines,
		handleCopyLines,
		handleInsertAndRunLines,
		handleRun,
		handleStop,
		handleCopy,
		handleExport,
		handleExportShell,
		handleExportReport,
		handleOpenFile,
		handlePasteText,
		openSaveAsCase,
		handleSaveAsCase,
		setSaveOpen,
	};
}

export type { InspectorScript$ };
