import { devLog } from "@/app/dev-log";
import { useEnterOnce } from "@/app/motion/use-enter-once";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import {
	activeDeviceSessionQueryKey,
	useActiveDeviceSession,
} from "@/features/devices/use-active-device-session";
import { tapLinesForSelection } from "@/features/inspector/command-snippets";
import { ElementActionDialog } from "@/features/inspector/element-action-dialog";
import { InspectorFeedController } from "@/features/inspector/inspector-feed";
import { SaveAsTestCaseDialog } from "@/features/inspector/save-as-test-case-dialog";
import { ScreenshotPanel } from "@/features/inspector/screenshot-panel";
import { type RunLogEntry, ScriptPanel } from "@/features/inspector/script-panel";
import { type InspectorSelection, appendScriptLines } from "@/features/inspector/selection";
import {
	type TestCase,
	caseQueryKey,
	casesQueryKey,
	mapCatalogCase,
} from "@/features/test-cases/data";
import { toast } from "@heroui/react";
import { useValue } from "@legendapp/state/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type ActionRequest,
	DEFAULT_SHELL_SCRIPT_HEADER,
	type RunReportDocument,
	buildRunReportFromInspectorSession,
	formatActionShellLine,
	formatRunReportHtml,
	formatRunReportMarkdown,
	formatSleepShellLine,
	runYoqaShellScript,
	shellToCaseScript,
	suggestedRunReportBasename,
} from "@yoqa/runner-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Accessibility tree refresh when using screenshot poll (not during MJPEG). */
const TREE_REFRESH_MS = 8000;
/** Fallback screenshot poll when Appium MJPEG is unavailable. */
const FALLBACK_SCREENSHOT_MS = 250;

type InspectorReportStep = {
	index: number;
	summary: string;
	ok: boolean;
	latencyMs: number | null;
	detail: string | null;
	command: string | null;
	screenshotBase64: string | null;
};

function notify(message: string) {
	toast.success(message);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function downloadTextFile(filename: string, contents: string, mime: string) {
	const blob = new Blob([contents], { type: mime });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function swipeAction(direction: "up" | "down" | "left" | "right"): ActionRequest {
	const mid = 500;
	const near = 200;
	const far = 800;
	switch (direction) {
		case "up":
			return { kind: "swipe", x: mid, y: far, x2: mid, y2: near };
		case "down":
			return { kind: "swipe", x: mid, y: near, x2: mid, y2: far };
		case "left":
			return { kind: "swipe", x: far, y: mid, x2: near, y2: mid };
		case "right":
			return { kind: "swipe", x: near, y: mid, x2: far, y2: mid };
	}
}

function scriptHasBody(script: string): boolean {
	return script.split(/\r?\n/).some((line) => {
		const t = line.trim();
		return t.length > 0 && !t.startsWith("#") && t !== "set -euo pipefail";
	});
}

function defaultCaseNameFromScript(script: string): string {
	for (const line of script.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#") && !trimmed.startsWith("#!") && !trimmed.includes("Yoqa")) {
			const label = trimmed.replace(/^#\s*/, "").trim();
			if (label.length > 0 && label.length <= 80) return label;
		}
	}
	const stamp = new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date());
	return `Inspector script · ${stamp}`;
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * `work()`'s value, or what it threw. Keeps try/catch out of the component: the React
 * Compiler skips any component with conditionals inside a try block.
 */
async function settle<T>(work: () => Promise<T>): Promise<Settled<T>> {
	try {
		return { ok: true, value: await work() };
	} catch (error) {
		return { ok: false, error };
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function exportRunReport(report: RunReportDocument, format: "html" | "md") {
	try {
		const baseName = suggestedRunReportBasename(report);
		if (format === "html") {
			downloadTextFile(`${baseName}.html`, formatRunReportHtml(report), "text/html;charset=utf-8");
			notify("HTML report exported");
		} else {
			downloadTextFile(
				`${baseName}.md`,
				formatRunReportMarkdown(report),
				"text/markdown;charset=utf-8",
			);
			notify("Markdown report exported");
		}
	} catch (error) {
		showErrorToast(error, "Failed to export report");
	}
}

function miniScriptFromLines(lines: string[]): string {
	return `${DEFAULT_SHELL_SCRIPT_HEADER}\n${lines.join("\n")}\n`;
}

export function InspectorPage() {
	const entered = useEnterOnce(true);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeSession } = useActiveDeviceSession();

	const [controller] = useState(
		() =>
			new InspectorFeedController({
				onSessionGone: () => {
					queryClient.setQueryData(activeDeviceSessionQueryKey, null);
					void queryClient.invalidateQueries({ queryKey: activeDeviceSessionQueryKey });
				},
			}),
	);
	const feed$ = controller.feed$;
	const active = useValue(feed$.active);
	const feedMode = useValue(feed$.feedMode);
	const elements = useValue(feed$.elements);
	const selection = useValue(feed$.selection);
	const liveControl = useValue(feed$.liveControl);
	const [script, setScript] = useState(DEFAULT_SHELL_SCRIPT_HEADER);
	const [running, setRunning] = useState(false);
	const [activeLineNumber, setActiveLineNumber] = useState<number | null>(null);
	const [log, setLog] = useState<RunLogEntry[]>([]);
	const [pageVisible, setPageVisible] = useState(
		typeof document === "undefined" ? true : document.visibilityState === "visible",
	);
	const [saveOpen, setSaveOpen] = useState(false);
	const [savingCase, setSavingCase] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [sessionReport, setSessionReport] = useState<RunReportDocument | null>(null);
	const [exportingReport, setExportingReport] = useState(false);

	const abortRef = useRef<AbortController | null>(null);
	const logIdRef = useRef(0);
	const controlWsRef = useRef<WebSocket | null>(null);
	const pointerSeqRef = useRef(0);

	const pushLog = useCallback((text: string, tone: RunLogEntry["tone"] = "info") => {
		logIdRef.current += 1;
		const id = String(logIdRef.current);
		setLog((prev) => [...prev, { id, text, tone }]);
	}, []);

	/** Attach the Inspector to the Active Session. Only the user does this (Connect). */
	const handleConnect = useCallback(() => {
		if (!activeSession || feed$.active.peek()) return;
		void controller.connect(activeSession);
	}, [activeSession, controller, feed$]);

	const handleDisconnect = useCallback(() => controller.disconnect(), [controller]);

	const handleLiveControlChange = useCallback(
		(enabled: boolean) => controller.setLiveControl(enabled),
		[controller],
	);

	const handleSelect = useCallback(
		(next: InspectorSelection | null) => controller.select(next),
		[controller],
	);

	const handleSelectWithPoint = useCallback(
		(next: InspectorSelection) => {
			void controller.selectWithPoint(next);
		},
		[controller],
	);

	const handleChangeSelector = useCallback(() => controller.cycleSelector(), [controller]);

	const handleRefreshTree = useCallback(() => {
		void controller.refreshTree({ silent: false });
	}, [controller]);

	useEffect(() => {
		devLog("Inspector page visibility", { visibilityState: document.visibilityState });
		const onVisibility = () => {
			devLog("Inspector page visibility changed", { visibilityState: document.visibilityState });
			setPageVisible(document.visibilityState === "visible");
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);

	// The Inspector never attaches on its own, but it lets go when the Active Session it is
	// attached to goes away: a disconnect, restart or another device from the top bar.
	const sessionDeviceId = activeSession?.deviceId ?? null;
	useEffect(() => {
		const attached = feed$.active.peek();
		if (!attached || attached.deviceId === sessionDeviceId) return;
		controller.clear();
	}, [controller, feed$, sessionDeviceId]);

	// Switching app points the Active Session at it (top bar); the cached tree was read for
	// the previous app, so the next selection reads the Screen again.
	const selectedAppId = selectedApp?.id;
	useEffect(() => {
		if (!selectedAppId) return;
		controller.markTreeStale();
	}, [controller, selectedAppId]);

	// Leaving the page detaches; the device session stays connected in the top bar.
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			controller.clear();
		};
	}, [controller]);

	// Accessibility tree refresh — only on poll feed. MJPEG + pageSource on the
	// same WDA session routinely kills the stream a few seconds after connect.
	useEffect(() => {
		if (!active || !pageVisible || feedMode !== "poll") return;
		const tick = () => {
			if (feed$.unreachable.peek()) return;
			void controller.refreshTree({ silent: true });
		};
		tick();
		const timer = window.setInterval(tick, TREE_REFRESH_MS);
		return () => window.clearInterval(timer);
	}, [active, controller, feed$, feedMode, pageVisible]);

	// Under Stream + Select mode, warm the tree once after connect (deferred so MJPEG can settle).
	useEffect(() => {
		if (!active || !pageVisible || feedMode !== "mjpeg" || liveControl) return;
		if (controller.treeLoaded) return;
		const timer = window.setTimeout(() => {
			if (!feed$.active.peek() || controller.treeLoaded) return;
			void controller.refreshTree({ silent: true });
		}, 1500);
		return () => window.clearTimeout(timer);
	}, [active, controller, feed$, feedMode, liveControl, pageVisible]);

	// Fallback PNG poll only when MJPEG is unavailable.
	useEffect(() => {
		if (!active || feedMode !== "poll") return;
		devLog(pageVisible ? "Screenshot poll started" : "Screenshot poll paused: page hidden", {
			deviceId: active.deviceId,
			visibilityState: document.visibilityState,
		});
		if (!pageVisible) return;
		const tick = () => {
			void controller.pollTick();
		};
		tick();
		const timer = window.setInterval(tick, FALLBACK_SCREENSHOT_MS);
		return () => window.clearInterval(timer);
	}, [active, controller, feedMode, pageVisible]);

	// Live control WebSocket while the toggle is on.
	useEffect(() => {
		if (!active || !liveControl || !pageVisible) {
			controlWsRef.current?.close();
			controlWsRef.current = null;
			return;
		}

		let cancelled = false;
		let ws: WebSocket | null = null;

		void getRunnerClient().then(
			(client) => {
				if (cancelled) return;
				ws = new WebSocket(client.getControlWsUrl());
				controlWsRef.current = ws;
				ws.onclose = () => {
					if (controlWsRef.current === ws) {
						controlWsRef.current = null;
					}
				};
			},
			(error: unknown) => {
				if (cancelled) return;
				showErrorToast(error, "Failed to open live control");
				controller.setLiveControl(false);
			},
		);

		return () => {
			cancelled = true;
			ws?.close();
			if (controlWsRef.current === ws) {
				controlWsRef.current = null;
			}
		};
	}, [active, controller, liveControl, pageVisible]);

	const sendPointer = useCallback((phase: "begin" | "move" | "end", x: number, y: number) => {
		const ws = controlWsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		pointerSeqRef.current += 1;
		ws.send(
			JSON.stringify({
				type: "pointer",
				phase,
				x,
				y,
				seq: pointerSeqRef.current,
			}),
		);
	}, []);

	const appendLines = useCallback((lines: string[]) => {
		setScript((prev) => appendScriptLines(prev, lines));
	}, []);

	const handleDoubleTap = useCallback(
		(next: InspectorSelection) => {
			controller.select(next);
			appendLines(tapLinesForSelection(next));
		},
		[appendLines, controller],
	);

	const handleAddSwipe = useCallback(
		(direction: "up" | "down" | "left" | "right") => {
			appendLines([`# swipe ${direction}`, formatActionShellLine(swipeAction(direction))]);
		},
		[appendLines],
	);

	const handleAddWait = useCallback(
		(seconds: number) => {
			appendLines([formatSleepShellLine(seconds)]);
		},
		[appendLines],
	);

	const handleInsertLines = useCallback(
		(lines: string[]) => {
			if (lines.length === 0) return;
			appendLines(lines);
			notify("Inserted");
		},
		[appendLines],
	);

	const handleCopyLines = useCallback((lines: string[]) => {
		if (lines.length === 0) return;
		navigator.clipboard.writeText(lines.join("\n")).then(
			() => notify("Copied command"),
			(error: unknown) => showErrorToast(error, "Failed to copy"),
		);
	}, []);

	const runLines = useCallback(
		async (lines: string[], options: { resetLog: boolean; label: string }) => {
			if (!active || running || lines.length === 0) return;
			const aborter = new AbortController();
			abortRef.current = aborter;
			setRunning(true);
			if (options.resetLog) {
				setLog([]);
			}
			setActiveLineNumber(null);
			pushLog(options.label);
			const outcome = await settle(async () =>
				runYoqaShellScript(await getRunnerClient(), miniScriptFromLines(lines), {
					signal: aborter.signal,
					pauseAfterActionMs: 200,
					onStep: async ({ step, status, error }) => {
						setActiveLineNumber(step.lineNumber);
						if (status === "running") {
							pushLog(`→ ${step.raw}`);
						} else if (status === "ok") {
							pushLog(`✓ ${step.raw}`, "ok");
						} else if (status === "error") {
							pushLog(`✗ ${step.raw}: ${error ?? "failed"}`, "error");
						}
					},
				}),
			);
			if (!outcome.ok) {
				pushLog(errorMessage(outcome.error), "error");
				showErrorToast(outcome.error, "Command failed");
			} else if (outcome.value.ok) {
				pushLog(`Done · ${outcome.value.completed}/${outcome.value.total} steps`, "ok");
				notify("Command finished");
			} else {
				pushLog(outcome.value.error ?? "Command failed", "error");
				if (outcome.value.error !== "Aborted") {
					showErrorToast(outcome.value.error ?? "Command failed", "Command failed");
				}
			}
			setRunning(false);
			setActiveLineNumber(null);
			abortRef.current = null;
			void controller.refreshTree({ silent: true });
		},
		[active, controller, pushLog, running],
	);

	const handleInsertAndRunLines = useCallback(
		(lines: string[]) => {
			if (lines.length === 0) return;
			appendLines(lines);
			void runLines(lines, { resetLog: false, label: "Insert & Run…" });
		},
		[appendLines, runLines],
	);

	const appName = selectedApp?.name ?? null;
	const handleRun = useCallback(async () => {
		if (!active || running) return;
		const aborter = new AbortController();
		abortRef.current = aborter;
		setRunning(true);
		setLog([]);
		setSessionReport(null);
		setActiveLineNumber(null);
		pushLog("Starting script…");
		const startedAt = Date.now();
		const reportSteps: InspectorReportStep[] = [];
		let stepStartedAt = startedAt;
		const outcome = await settle(async () => {
			const client = await getRunnerClient();
			return runYoqaShellScript(client, script, {
				signal: aborter.signal,
				pauseAfterActionMs: 200,
				onStep: async ({ index, step, status, error }) => {
					setActiveLineNumber(step.lineNumber);
					if (status === "running") {
						stepStartedAt = Date.now();
						pushLog(`→ L${step.lineNumber} ${step.raw}`);
						return;
					}
					// Screenshot is optional for the report.
					const bytes = await client.fetchScreenshotBytes().catch(() => null);
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
						pushLog(`✓ L${step.lineNumber}`, "ok");
					} else {
						pushLog(`✗ L${step.lineNumber}: ${error ?? "failed"}`, "error");
					}
				},
			});
		});
		const result = outcome.ok
			? outcome.value
			: { ok: false as const, completed: 0, total: 0, error: errorMessage(outcome.error) };
		setSessionReport(
			buildRunReportFromInspectorSession({
				title: defaultCaseNameFromScript(script),
				appLabel: appName,
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
			pushLog(errorMessage(outcome.error), "error");
			showErrorToast(outcome.error, "Script failed");
		} else if (result.ok) {
			pushLog(`Done · ${result.completed}/${result.total} steps`, "ok");
			notify("Script finished");
		} else {
			pushLog(result.error ?? "Script failed", "error");
			if (result.error !== "Aborted") {
				showErrorToast(result.error ?? "Script failed", "Script failed");
			}
		}
		setRunning(false);
		setActiveLineNumber(null);
		abortRef.current = null;
		void controller.refreshTree({ silent: true });
	}, [active, controller, pushLog, running, script, appName]);

	const handleStop = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(script).then(
			() => notify("Copied script"),
			(error: unknown) => showErrorToast(error, "Failed to copy script"),
		);
	}, [script]);

	const handleExport = useCallback(() => {
		const blob = new Blob([script], { type: "text/x-shellscript" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "yoqa-inspector.sh";
		anchor.click();
		URL.revokeObjectURL(url);
	}, [script]);

	const handleExportReport = useCallback(
		(format: "html" | "md") => {
			if (!sessionReport) return;
			setExportingReport(true);
			exportRunReport(sessionReport, format);
			setExportingReport(false);
		},
		[sessionReport],
	);
	const casePreview = useMemo(() => shellToCaseScript(script, { elements }), [elements, script]);

	const openSaveAsCase = useCallback(() => {
		setSaveError(null);
		if (!selectedApp) {
			showErrorToast(new Error("Select an app first"), "Select an app");
			return;
		}
		if (!scriptHasBody(script)) {
			showErrorToast(new Error("Add actions to the script first"), "Nothing to save");
			return;
		}
		if (!casePreview.script) {
			showErrorToast(
				new Error(
					casePreview.warnings[0] ??
						"Only tap, type, wait, and alert convert to a saved script. Prefer tap --label/--id or re-record after this fix.",
				),
				"Nothing convertible",
			);
			return;
		}
		setSaveOpen(true);
	}, [casePreview.script, casePreview.warnings, script, selectedApp]);

	const handleSaveAsCase = useCallback(
		async (name: string) => {
			if (!selectedApp) {
				setSaveError("Select an app first");
				return;
			}
			const converted = shellToCaseScript(script, {
				elements,
				savedAt: Date.now(),
			});
			if (!converted.script) {
				setSaveError("No convertible actions in the script");
				return;
			}
			setSavingCase(true);
			setSaveError(null);
			const appId = selectedApp.id;
			const caseScript = converted.script;
			const outcome = await settle(async () => {
				const client = await getRunnerClient();
				const created = await client.createCase(appId, {
					name,
					flows: [
						{
							instructions: "Recorded in Manual Inspector",
							expectedResult: "",
						},
					],
				});
				return mapCatalogCase(await client.updateCase(created.id, { script: caseScript }));
			});
			if (outcome.ok) {
				const mapped = outcome.value;
				queryClient.setQueryData(caseQueryKey(mapped.id), mapped);
				queryClient.setQueryData<TestCase[]>(casesQueryKey(appId), (current) =>
					current ? [mapped, ...current.filter((row) => row.id !== mapped.id)] : [mapped],
				);
				setSaveOpen(false);
				notify(`Saved as #${mapped.number} ${mapped.name}`);
				void navigate({ to: "/test-cases/$caseId", params: { caseId: mapped.id } });
			} else {
				setSaveError(errorMessage(outcome.error));
				showErrorToast(outcome.error, "Failed to create test case");
			}
			setSavingCase(false);
		},
		[elements, navigate, queryClient, script, selectedApp],
	);

	const connected = active != null;
	// A Run owns the shared session while live — the inspector becomes a viewer.
	const viewOnly = connected && Boolean(activeSession?.heldByRun);

	useEffect(() => {
		if (viewOnly && liveControl) {
			controller.setLiveControl(false);
		}
	}, [controller, viewOnly, liveControl]);
	const canSaveAsCase = Boolean(selectedApp) && scriptHasBody(script);
	const snippetContext = useMemo(
		() => ({
			defaultAppId:
				active?.platform === "android"
					? (selectedApp?.androidApplicationId.trim() ?? "")
					: (selectedApp?.iosBundleId.trim() ?? ""),
		}),
		[active?.platform, selectedApp?.androidApplicationId, selectedApp?.iosBundleId],
	);

	return (
		<div
			className={[
				"flex h-full min-h-0 flex-col gap-5 px-4 pb-4",
				entered ? "motion-enter-done" : "motion-enter",
			].join(" ")}
		>
			<div className="flex min-h-0 flex-1 gap-5">
				<div className="min-w-75 flex-[0_1_360px] self-start">
					<ScreenshotPanel
						feed$={feed$}
						session={activeSession}
						onConnect={handleConnect}
						onDisconnect={handleDisconnect}
						pageVisible={pageVisible}
						onLiveControlChange={handleLiveControlChange}
						disabled={!connected || running || viewOnly}
						onSelect={handleSelect}
						onSelectWithPoint={handleSelectWithPoint}
						onRefreshTree={handleRefreshTree}
						onDoubleTap={handleDoubleTap}
						onPointer={sendPointer}
						onClearSelection={() => handleSelect(null)}
					/>
				</div>

				<div className="h-full min-h-0 min-w-0 flex-[2_1_440px] overflow-y-auto">
					<ScriptPanel
						script={script}
						onScriptChange={setScript}
						editingDisabled={running}
						activeLineNumber={activeLineNumber}
						running={running}
						canRun={connected && !running && !viewOnly && scriptHasBody(script)}
						canSaveAsCase={canSaveAsCase}
						canExportReport={sessionReport != null}
						exportingReport={exportingReport}
						log={log}
						onRun={() => {
							void handleRun();
						}}
						onStop={handleStop}
						onCopy={() => {
							handleCopy();
						}}
						onExport={handleExport}
						onExportReportHtml={() => {
							handleExportReport("html");
						}}
						onExportReportMarkdown={() => {
							handleExportReport("md");
						}}
						onSaveAsCase={openSaveAsCase}
					/>
				</div>
			</div>

			<ElementActionDialog
				selection={liveControl ? null : selection}
				elements={elements}
				disabled={!connected || running || viewOnly}
				snippetContext={snippetContext}
				canChangeSelector={Boolean(selection?.element)}
				onChangeSelector={handleChangeSelector}
				onInsert={handleInsertLines}
				onInsertAndRun={handleInsertAndRunLines}
				onCopyLines={(lines) => {
					handleCopyLines(lines);
				}}
				onClose={() => handleSelect(null)}
				gesturesDisabled={running || viewOnly}
				onAddSwipe={handleAddSwipe}
				onAddWait={handleAddWait}
			/>

			<SaveAsTestCaseDialog
				isOpen={saveOpen}
				onOpenChange={(open) => {
					setSaveOpen(open);
					if (!open) setSaveError(null);
				}}
				defaultName={defaultCaseNameFromScript(script)}
				appName={selectedApp?.name ?? null}
				actionCount={casePreview.script?.actions.length ?? 0}
				warnings={[
					...casePreview.warnings,
					...casePreview.errors.map((err) => `L${err.lineNumber}: parse error — ${err.message}`),
				]}
				saving={savingCase}
				error={saveError}
				onConfirm={(name) => {
					void handleSaveAsCase(name);
				}}
			/>
		</div>
	);
}
