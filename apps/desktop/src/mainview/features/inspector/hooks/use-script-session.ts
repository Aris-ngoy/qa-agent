import { showErrorToast } from "@/app/show-error-toast";
import type { Application } from "@/features/apps/context";
import { readScreenshotBytes } from "@/features/inspector/data/api/screen";
import { runInspectorShellScript } from "@/features/inspector/data/api/script";
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
	defaultCaseNameFromScript,
	miniScriptFromLines,
	scriptHasBody,
	swipeLines,
	waitLine,
} from "@/features/inspector/utils/script-text";
import type { InspectorSelection } from "@/features/inspector/utils/selection";
import { errorMessage, settle } from "@/features/inspector/utils/settle";
import { useObservable } from "@legendapp/state/react";
import { useNavigate } from "@tanstack/react-router";
import { buildRunReportFromInspectorSession, shellToCaseScript } from "@yoqa/runner-client";
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

/** Script text, run log, and save-as-case. State lives on `script$` for this page visit. */
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

	const appendLines = (lines: string[]) => {
		appendScript(script$, lines);
	};

	const handleDoubleTap = (next: InspectorSelection) => {
		controller.select(next);
		appendLines(tapLinesForSelection(next));
	};

	const handleAddSwipe = (direction: "up" | "down" | "left" | "right") => {
		appendLines(swipeLines(direction));
	};

	const handleAddWait = (seconds: number) => {
		appendLines([waitLine(seconds)]);
	};

	const handleInsertLines = (lines: string[]) => {
		if (lines.length === 0) return;
		appendLines(lines);
		notify("Inserted");
	};

	const handleCopyLines = (lines: string[]) => {
		if (lines.length === 0) return;
		navigator.clipboard.writeText(lines.join("\n")).then(
			() => notify("Copied command"),
			(error: unknown) => showErrorToast(error, "Failed to copy"),
		);
	};

	const runLines = async (lines: string[], options: { resetLog: boolean; label: string }) => {
		const active = feed$.active.peek();
		if (!active || script$.running.peek() || lines.length === 0) return;
		const aborter = new AbortController();
		abortRef.current = aborter;
		beginRun(script$, {
			resetLog: options.resetLog,
			clearReport: false,
			entry: { id: nextLogId(), text: options.label, tone: "info" },
		});
		const outcome = await settle(() =>
			runInspectorShellScript(miniScriptFromLines(lines), {
				signal: aborter.signal,
				pauseAfterActionMs: 200,
				onStep: async ({ step, status, error }) => {
					script$.activeLineNumber.set(step.lineNumber);
					if (status === "running") {
						log(`→ ${step.raw}`);
					} else if (status === "ok") {
						log(`✓ ${step.raw}`, "ok");
					} else if (status === "error") {
						log(`✗ ${step.raw}: ${error ?? "failed"}`, "error");
					}
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
		appendLines(lines);
		void runLines(lines, { resetLog: false, label: "Insert & Run…" });
	};

	const handleRun = async () => {
		const active = feed$.active.peek();
		if (!active || script$.running.peek()) return;
		const script = script$.text.peek();
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
			runInspectorShellScript(script, {
				signal: aborter.signal,
				pauseAfterActionMs: 200,
				onStep: async ({ index, step, status, error }) => {
					script$.activeLineNumber.set(step.lineNumber);
					if (status === "running") {
						stepStartedAt = Date.now();
						log(`→ L${step.lineNumber} ${step.raw}`);
						return;
					}
					const bytes = await readScreenshotBytes().catch(() => null);
					const ok = status === "ok";
					reportSteps.push({
						index: index + 1,
						summary: step.raw,
						ok,
						latencyMs: Math.max(0, Date.now() - stepStartedAt),
						detail: ok ? null : (error ?? "failed"),
						command: step.raw,
						screenshotBase64: bytes ? bytesToBase64(bytes) : null,
					});
					if (ok) {
						log(`✓ L${step.lineNumber}`, "ok");
					} else {
						log(`✗ L${step.lineNumber}: ${error ?? "failed"}`, "error");
					}
				},
			}),
		);
		const result = outcome.ok
			? outcome.value
			: { ok: false as const, completed: 0, total: 0, error: errorMessage(outcome.error) };
		script$.report.set(
			buildRunReportFromInspectorSession({
				title: defaultCaseNameFromScript(script),
				appLabel: selectedApp?.name ?? null,
				deviceLabel: active.deviceId,
				platform: active.platform,
				ok: result.ok,
				cancelled: outcome.ok && result.error === "Aborted",
				error: result.ok ? null : (result.error ?? "Script failed"),
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
			log(result.error ?? "Script failed", "error");
			if (result.error !== "Aborted") {
				showErrorToast(result.error ?? "Script failed", "Script failed");
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

	const handleExport = () => {
		downloadTextFile("yoqa-inspector.sh", script$.text.peek(), "text/x-shellscript");
	};

	const handleExportReport = (format: "html" | "md") => {
		const report = script$.report.peek();
		if (!report) return;
		script$.exportingReport.set(true);
		exportRunReport(report, format);
		script$.exportingReport.set(false);
	};

	const openSaveAsCase = () => {
		script$.saveError.set(null);
		const script = script$.text.peek();
		if (!selectedApp) {
			showErrorToast(new Error("Select an app first"), "Select an app");
			return;
		}
		if (!scriptHasBody(script)) {
			showErrorToast(new Error("Add actions to the script first"), "Nothing to save");
			return;
		}
		const preview = shellToCaseScript(script, { elements: feed$.elements.peek() });
		if (!preview.script) {
			showErrorToast(
				new Error(
					preview.warnings[0] ??
						"Only tap, type, wait, and alert convert to a saved script. Prefer tap --label/--id or re-record after this fix.",
				),
				"Nothing convertible",
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
		const converted = shellToCaseScript(script$.text.peek(), {
			elements: feed$.elements.peek(),
			savedAt: Date.now(),
		});
		if (!converted.script) {
			script$.saveError.set("No convertible actions in the script");
			return;
		}
		const caseScript = converted.script;
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
		handleExportReport,
		openSaveAsCase,
		handleSaveAsCase,
		setSaveOpen,
	};
}

export type { InspectorScript$ };
