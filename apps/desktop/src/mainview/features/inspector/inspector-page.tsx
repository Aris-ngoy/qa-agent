import { useEnterOnce } from "@/app/motion/use-enter-once";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import type { DevicePlatform, SelectedDevice } from "@/features/devices/select-device-modal";
import { CommandBar } from "@/features/inspector/command-bar";
import { tapLinesForSelection } from "@/features/inspector/command-snippets";
import { type RunLogEntry, RunPanel } from "@/features/inspector/run-panel";
import { SaveAsTestCaseDialog } from "@/features/inspector/save-as-test-case-dialog";
import { ScreenshotPanel } from "@/features/inspector/screenshot-panel";
import { ScriptEditor } from "@/features/inspector/script-editor";
import { type InspectorSelection, appendScriptLines } from "@/features/inspector/selection";
import { SessionToolbar } from "@/features/inspector/session-toolbar";
import { useActiveRun } from "@/features/runs/active-run-context";
import {
	type TestCase,
	caseQueryKey,
	casesQueryKey,
	mapCatalogCase,
} from "@/features/test-cases/data";
import { toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type ActionRequest,
	type ActiveDeviceResponse,
	DEFAULT_SHELL_SCRIPT_HEADER,
	type RunReportDocument,
	type ScreenElement,
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

/** How often to pull a fresh screenshot while connected. */
const LIVE_SCREENSHOT_MS = 150;
/** Refresh the accessibility tree every N screenshot polls (tree is slower). */
const TREE_EVERY_N_POLLS = 15;

type InspectorReportStep = {
	index: number;
	summary: string;
	ok: boolean;
	latencyMs: number | null;
	detail: string | null;
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
		if (trimmed.startsWith("#") && !trimmed.startsWith("#!") && !trimmed.includes("YoQA")) {
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

function bytesToPngBlob(bytes: Uint8Array): Blob {
	const copy = Uint8Array.from(bytes);
	return new Blob([copy.buffer], { type: "image/png" });
}

function miniScriptFromLines(lines: string[]): string {
	return `${DEFAULT_SHELL_SCRIPT_HEADER}\n${lines.join("\n")}\n`;
}

export function InspectorPage() {
	const entered = useEnterOnce(true);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { isRunLive } = useActiveRun();

	const [platform, setPlatform] = useState<DevicePlatform>("ios");
	const [device, setDevice] = useState<SelectedDevice | null>(null);
	const [active, setActive] = useState<ActiveDeviceResponse | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [bootLoading, setBootLoading] = useState(false);
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [elements, setElements] = useState<ScreenElement[]>([]);
	const [selection, setSelection] = useState<InspectorSelection | null>(null);
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
	const imageUrlRef = useRef<string | null>(null);
	const inFlightRef = useRef(false);
	const pollCountRef = useRef(0);
	const activeRef = useRef<ActiveDeviceResponse | null>(null);

	useEffect(() => {
		activeRef.current = active;
	}, [active]);

	const pushLog = useCallback((text: string, tone: RunLogEntry["tone"] = "info") => {
		logIdRef.current += 1;
		const id = String(logIdRef.current);
		setLog((prev) => [...prev, { id, text, tone }]);
	}, []);

	const revokeImage = useCallback(() => {
		if (imageUrlRef.current) {
			URL.revokeObjectURL(imageUrlRef.current);
			imageUrlRef.current = null;
		}
		setImageUrl(null);
	}, []);

	const refreshFrame = useCallback(
		async (options: { includeTree?: boolean; silent?: boolean } = {}) => {
			const includeTree = options.includeTree ?? true;
			const silent = options.silent ?? false;
			if (inFlightRef.current) return;
			if (!activeRef.current) return;
			inFlightRef.current = true;
			if (!silent && !imageUrlRef.current) setBootLoading(true);
			try {
				const client = await getRunnerClient();
				const bytesPromise = client.fetchScreenshotBytes();
				const treePromise = includeTree ? client.getScreen() : Promise.resolve(null);
				const [bytes, screen] = await Promise.all([bytesPromise, treePromise]);
				if (!activeRef.current) return;

				const blob = bytesToPngBlob(bytes);
				const nextUrl = URL.createObjectURL(blob);
				const prev = imageUrlRef.current;
				imageUrlRef.current = nextUrl;
				setImageUrl(nextUrl);
				if (prev) URL.revokeObjectURL(prev);

				if (screen) {
					setElements(screen.elements ?? []);
				}
			} catch (error) {
				if (!silent) {
					showErrorToast(error, "Failed to refresh screen");
				}
			} finally {
				inFlightRef.current = false;
				setBootLoading(false);
			}
		},
		[],
	);

	useEffect(() => {
		const onVisibility = () => {
			setPageVisible(document.visibilityState === "visible");
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const client = await getRunnerClient();
				const current = await client.getActiveDevice();
				if (cancelled) return;
				setActive(current);
				if (current) {
					setPlatform(current.platform);
					await refreshFrame({ includeTree: true, silent: false });
				}
			} catch {
				/* runner may still be starting */
			}
		})();
		return () => {
			cancelled = true;
			abortRef.current?.abort();
			revokeImage();
		};
	}, [refreshFrame, revokeImage]);

	// Live screenshot loop while connected and the page is visible.
	useEffect(() => {
		if (!active || !pageVisible) return;

		let cancelled = false;
		pollCountRef.current = 0;

		const tick = async () => {
			if (cancelled || !activeRef.current) return;
			pollCountRef.current += 1;
			const includeTree = pollCountRef.current % TREE_EVERY_N_POLLS === 0;
			await refreshFrame({ includeTree, silent: true });
		};

		void tick();
		const timer = window.setInterval(() => {
			void tick();
		}, LIVE_SCREENSHOT_MS);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [active, pageVisible, refreshFrame]);

	const handleConnect = useCallback(async () => {
		if (!device) return;
		setConnecting(true);
		try {
			const client = await getRunnerClient();
			const bundleId =
				device.platform === "ios" ? selectedApp?.iosBundleId.trim() || undefined : undefined;
			const appPackage =
				device.platform === "android"
					? selectedApp?.androidApplicationId.trim() || undefined
					: undefined;
			const info = await client.connectDevice({
				deviceId: device.id,
				platform: device.platform,
				bundleId,
				appPackage,
			});
			setActive(info);
			setSelection(null);
			await refreshFrame({ includeTree: true, silent: false });
			notify("Connected — live feed on");
		} catch (error) {
			showErrorToast(error, "Failed to connect device");
		} finally {
			setConnecting(false);
		}
	}, [device, refreshFrame, selectedApp]);

	const handleDisconnect = useCallback(async () => {
		if (scriptHasBody(script) && !window.confirm("Disconnect and keep the current script?")) {
			return;
		}
		setConnecting(true);
		try {
			const client = await getRunnerClient();
			await client.disconnectDevice();
			setActive(null);
			setSelection(null);
			setElements([]);
			revokeImage();
			notify("Disconnected");
		} catch (error) {
			showErrorToast(error, "Failed to disconnect");
		} finally {
			setConnecting(false);
		}
	}, [revokeImage, script]);

	const appendLines = useCallback((lines: string[]) => {
		setScript((prev) => appendScriptLines(prev, lines));
	}, []);

	const handleDoubleTap = useCallback(
		(next: InspectorSelection) => {
			setSelection(next);
			appendLines(tapLinesForSelection(next));
		},
		[appendLines],
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

	const handleCopyLines = useCallback(async (lines: string[]) => {
		if (lines.length === 0) return;
		try {
			await navigator.clipboard.writeText(lines.join("\n"));
			notify("Copied command");
		} catch (error) {
			showErrorToast(error, "Failed to copy");
		}
	}, []);

	const runLines = useCallback(
		async (lines: string[], options: { resetLog: boolean; label: string }) => {
			if (!active || running || lines.length === 0) return;
			const controller = new AbortController();
			abortRef.current = controller;
			setRunning(true);
			if (options.resetLog) {
				setLog([]);
			}
			setActiveLineNumber(null);
			pushLog(options.label);
			try {
				const client = await getRunnerClient();
				const result = await runYoqaShellScript(client, miniScriptFromLines(lines), {
					signal: controller.signal,
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
				});
				if (result.ok) {
					pushLog(`Done · ${result.completed}/${result.total} steps`, "ok");
					notify("Command finished");
				} else {
					pushLog(result.error ?? "Command failed", "error");
					if (result.error !== "Aborted") {
						showErrorToast(result.error ?? "Command failed", "Command failed");
					}
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				pushLog(message, "error");
				showErrorToast(error, "Command failed");
			} finally {
				setRunning(false);
				setActiveLineNumber(null);
				abortRef.current = null;
				void refreshFrame({ includeTree: true, silent: true });
			}
		},
		[active, pushLog, refreshFrame, running],
	);

	const handleInsertAndRunLines = useCallback(
		(lines: string[]) => {
			if (lines.length === 0) return;
			appendLines(lines);
			void runLines(lines, { resetLog: false, label: "Insert & Run…" });
		},
		[appendLines, runLines],
	);

	const handleRun = useCallback(async () => {
		if (!active || running) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setRunning(true);
		setLog([]);
		setSessionReport(null);
		setActiveLineNumber(null);
		pushLog("Starting script…");
		const startedAt = Date.now();
		const reportSteps: InspectorReportStep[] = [];
		let stepStartedAt = startedAt;
		try {
			const client = await getRunnerClient();
			const result = await runYoqaShellScript(client, script, {
				signal: controller.signal,
				pauseAfterActionMs: 200,
				onStep: async ({ index, step, status, error }) => {
					setActiveLineNumber(step.lineNumber);
					if (status === "running") {
						stepStartedAt = Date.now();
						pushLog(`→ L${step.lineNumber} ${step.raw}`);
						return;
					}
					let screenshotBase64: string | null = null;
					try {
						const bytes = await client.fetchScreenshotBytes();
						screenshotBase64 = bytesToBase64(bytes);
					} catch {
						/* screenshot optional for report */
					}
					const ok = status === "ok";
					reportSteps.push({
						index: index + 1,
						summary: step.raw,
						ok,
						latencyMs: Math.max(0, Date.now() - stepStartedAt),
						detail: ok ? null : (error ?? "failed"),
						screenshotBase64,
					});
					if (ok) {
						pushLog(`✓ L${step.lineNumber}`, "ok");
					} else {
						pushLog(`✗ L${step.lineNumber}: ${error ?? "failed"}`, "error");
					}
				},
			});
			const finishedAt = Date.now();
			const cancelled = result.error === "Aborted";
			setSessionReport(
				buildRunReportFromInspectorSession({
					title: defaultCaseNameFromScript(script),
					appLabel: selectedApp?.name ?? null,
					deviceLabel: device?.name ?? active.deviceId,
					platform: active.platform,
					ok: result.ok,
					cancelled,
					error: result.ok ? null : (result.error ?? "Script failed"),
					startedAt,
					finishedAt,
					steps: reportSteps,
				}),
			);
			if (result.ok) {
				pushLog(`Done · ${result.completed}/${result.total} steps`, "ok");
				notify("Script finished");
			} else {
				pushLog(result.error ?? "Script failed", "error");
				if (result.error !== "Aborted") {
					showErrorToast(result.error ?? "Script failed", "Script failed");
				}
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			pushLog(message, "error");
			showErrorToast(error, "Script failed");
			setSessionReport(
				buildRunReportFromInspectorSession({
					title: defaultCaseNameFromScript(script),
					appLabel: selectedApp?.name ?? null,
					deviceLabel: device?.name ?? active.deviceId,
					platform: active.platform,
					ok: false,
					error: message,
					startedAt,
					finishedAt: Date.now(),
					steps: reportSteps,
				}),
			);
		} finally {
			setRunning(false);
			setActiveLineNumber(null);
			abortRef.current = null;
			void refreshFrame({ includeTree: true, silent: true });
		}
	}, [active, device?.name, pushLog, refreshFrame, running, script, selectedApp?.name]);

	const handleStop = useCallback(() => {
		abortRef.current?.abort();
	}, []);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(script);
			notify("Copied script");
		} catch (error) {
			showErrorToast(error, "Failed to copy script");
		}
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
			try {
				const baseName = suggestedRunReportBasename(sessionReport);
				if (format === "html") {
					downloadTextFile(
						`${baseName}.html`,
						formatRunReportHtml(sessionReport),
						"text/html;charset=utf-8",
					);
					notify("HTML report exported");
				} else {
					downloadTextFile(
						`${baseName}.md`,
						formatRunReportMarkdown(sessionReport),
						"text/markdown;charset=utf-8",
					);
					notify("Markdown report exported");
				}
			} catch (error) {
				showErrorToast(error, "Failed to export report");
			} finally {
				setExportingReport(false);
			}
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
						"Only tap, type, and wait convert to a saved script. Prefer tap (x,y) or re-record after this fix.",
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
			try {
				const client = await getRunnerClient();
				const created = await client.createCase(selectedApp.id, {
					name,
					flows: [
						{
							instructions: "Recorded in Manual Inspector",
							expectedResult: "",
						},
					],
				});
				const updated = await client.updateCase(created.id, {
					script: converted.script,
				});
				const mapped = mapCatalogCase(updated);
				queryClient.setQueryData(caseQueryKey(mapped.id), mapped);
				queryClient.setQueryData<TestCase[]>(casesQueryKey(selectedApp.id), (current) =>
					current ? [mapped, ...current.filter((row) => row.id !== mapped.id)] : [mapped],
				);
				setSaveOpen(false);
				notify(`Saved as #${mapped.number} ${mapped.name}`);
				void navigate({ to: "/test-cases/$caseId", params: { caseId: mapped.id } });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setSaveError(message);
				showErrorToast(error, "Failed to create test case");
			} finally {
				setSavingCase(false);
			}
		},
		[elements, navigate, queryClient, script, selectedApp],
	);

	const connected = active != null;
	const live = connected && pageVisible;
	const canSaveAsCase = Boolean(selectedApp) && scriptHasBody(script);
	const snippetContext = useMemo(
		() => ({
			defaultAppId:
				platform === "ios"
					? (selectedApp?.iosBundleId.trim() ?? "")
					: (selectedApp?.androidApplicationId.trim() ?? ""),
		}),
		[platform, selectedApp?.androidApplicationId, selectedApp?.iosBundleId],
	);

	return (
		<div className={["flex flex-col", entered ? "motion-enter-done" : "motion-enter"].join(" ")}>
			<header className="flex items-end justify-between gap-4 px-4 pt-2 pb-1">
				<div>
					<h1 className="text-title-lg font-semibold text-on-surface">Inspector</h1>
					<p className="text-body-sm text-on-surface-variant">
						Select an element for actions, or build a{" "}
						<code className="font-mono text-helper">yoqa</code> script by hand.
					</p>
				</div>
			</header>

			<SessionToolbar
				platform={platform}
				onPlatformChange={(next) => {
					setPlatform(next);
					setDevice(null);
				}}
				device={device}
				onDeviceSelect={setDevice}
				active={active}
				connecting={connecting}
				live={live}
				onConnect={() => {
					void handleConnect();
				}}
				onDisconnect={() => {
					void handleDisconnect();
				}}
				runLiveWarning={isRunLive}
			/>

			<div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(280px,2fr)_minmax(0,3fr)]">
				<ScreenshotPanel
					imageUrl={imageUrl}
					elements={elements}
					selection={selection}
					loading={bootLoading && !imageUrl}
					live={live}
					disabled={!connected || running}
					snippetContext={snippetContext}
					onSelect={setSelection}
					onDoubleTap={handleDoubleTap}
					onInsertLines={handleInsertLines}
					onInsertAndRunLines={handleInsertAndRunLines}
					onCopyLines={(lines) => {
						void handleCopyLines(lines);
					}}
					onClearSelection={() => setSelection(null)}
				/>

				<div className="flex flex-col gap-3">
					<CommandBar disabled={running} onAddSwipe={handleAddSwipe} onAddWait={handleAddWait} />
					<ScriptEditor
						value={script}
						onChange={setScript}
						disabled={running}
						activeLineNumber={activeLineNumber}
					/>
					<RunPanel
						running={running}
						canRun={connected && !running && scriptHasBody(script)}
						canSaveAsCase={canSaveAsCase}
						canExportReport={sessionReport != null}
						exportingReport={exportingReport}
						log={log}
						onRun={() => {
							void handleRun();
						}}
						onStop={handleStop}
						onCopy={() => {
							void handleCopy();
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
