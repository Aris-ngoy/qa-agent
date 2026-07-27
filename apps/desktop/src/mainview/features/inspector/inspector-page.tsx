import { useEnterOnce } from "@/app/motion/use-enter-once";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import type { DevicePlatform, SelectedDevice } from "@/features/devices/select-device-modal";
import { CommandBar } from "@/features/inspector/command-bar";
import { type RunLogEntry, RunPanel } from "@/features/inspector/run-panel";
import { ScreenshotPanel } from "@/features/inspector/screenshot-panel";
import { ScriptEditor } from "@/features/inspector/script-editor";
import { type InspectorSelection, appendScriptLines } from "@/features/inspector/selection";
import { SessionToolbar } from "@/features/inspector/session-toolbar";
import { useActiveRun } from "@/features/runs/active-run-context";
import { toast } from "@heroui/react";
import {
	type ActionRequest,
	type ActiveDeviceResponse,
	DEFAULT_SHELL_SCRIPT_HEADER,
	type ScreenElement,
	formatActionShellLine,
	formatSleepShellLine,
	runYoqaShellScript,
} from "@yoqa/runner-client";
import { useCallback, useEffect, useRef, useState } from "react";

function notify(message: string) {
	toast.success(message);
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

export function InspectorPage() {
	const entered = useEnterOnce(true);
	const { selectedApp } = useApps();
	const { isRunLive } = useActiveRun();

	const [platform, setPlatform] = useState<DevicePlatform>("ios");
	const [device, setDevice] = useState<SelectedDevice | null>(null);
	const [active, setActive] = useState<ActiveDeviceResponse | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [elements, setElements] = useState<ScreenElement[]>([]);
	const [selection, setSelection] = useState<InspectorSelection | null>(null);
	const [script, setScript] = useState(DEFAULT_SHELL_SCRIPT_HEADER);
	const [running, setRunning] = useState(false);
	const [activeLineNumber, setActiveLineNumber] = useState<number | null>(null);
	const [log, setLog] = useState<RunLogEntry[]>([]);

	const abortRef = useRef<AbortController | null>(null);
	const logIdRef = useRef(0);

	const pushLog = useCallback((text: string, tone: RunLogEntry["tone"] = "info") => {
		logIdRef.current += 1;
		const id = String(logIdRef.current);
		setLog((prev) => [...prev, { id, text, tone }]);
	}, []);

	const refreshScreen = useCallback(async () => {
		setRefreshing(true);
		try {
			const client = await getRunnerClient();
			const screen = await client.getScreen();
			const nextUrl = client.getScreenshotImageUrl(Date.now());
			setImageUrl(nextUrl);
			setElements(screen.elements ?? []);
		} catch (error) {
			showErrorToast(error, "Failed to refresh screen");
		} finally {
			setRefreshing(false);
		}
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
					await refreshScreen();
				}
			} catch {
				/* runner may still be starting */
			}
		})();
		return () => {
			cancelled = true;
			abortRef.current?.abort();
		};
	}, [refreshScreen]);

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
			await refreshScreen();
			notify("Connected to device");
		} catch (error) {
			showErrorToast(error, "Failed to connect device");
		} finally {
			setConnecting(false);
		}
	}, [device, refreshScreen, selectedApp]);

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
			setImageUrl(null);
			notify("Disconnected");
		} catch (error) {
			showErrorToast(error, "Failed to disconnect");
		} finally {
			setConnecting(false);
		}
	}, [script]);

	const appendLines = useCallback((lines: string[]) => {
		setScript((prev) => appendScriptLines(prev, lines));
	}, []);

	const handleAddTap = useCallback(() => {
		if (!selection) return;
		const comment =
			selection.element?.label || selection.element?.type
				? `# ${selection.element.label || selection.element.type}`
				: null;
		const line = formatActionShellLine({
			kind: "tap",
			x: selection.x,
			y: selection.y,
		});
		appendLines(comment ? [comment, line] : [line]);
	}, [appendLines, selection]);

	const handleAddInput = useCallback(
		(text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			appendLines([formatActionShellLine({ kind: "input", text: trimmed })]);
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

	const handleRun = useCallback(async () => {
		if (!active || running) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setRunning(true);
		setLog([]);
		setActiveLineNumber(null);
		pushLog("Starting script…");
		try {
			const client = await getRunnerClient();
			const result = await runYoqaShellScript(client, script, {
				signal: controller.signal,
				pauseAfterActionMs: 200,
				onStep: async ({ step, status, error }) => {
					setActiveLineNumber(step.lineNumber);
					if (status === "running") {
						pushLog(`→ L${step.lineNumber} ${step.raw}`);
					} else if (status === "ok") {
						pushLog(`✓ L${step.lineNumber}`, "ok");
						try {
							await refreshScreen();
						} catch {
							/* keep running */
						}
					} else if (status === "error") {
						pushLog(`✗ L${step.lineNumber}: ${error ?? "failed"}`, "error");
					}
				},
			});
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
		} finally {
			setRunning(false);
			setActiveLineNumber(null);
			abortRef.current = null;
		}
	}, [active, pushLog, refreshScreen, running, script]);

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

	const connected = active != null;

	return (
		<div
			className={[
				"flex h-full min-h-0 flex-col",
				entered ? "motion-enter-done" : "motion-enter",
			].join(" ")}
		>
			<header className="px-4 pt-4 pb-1">
				<h1 className="text-title-lg font-semibold text-on-surface">Inspector</h1>
				<p className="text-body-sm text-on-surface-variant">
					Select elements, build a <code className="font-mono text-helper">yoqa action</code>{" "}
					script, and run it on the connected device.
				</p>
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
				refreshing={refreshing}
				onConnect={() => {
					void handleConnect();
				}}
				onDisconnect={() => {
					void handleDisconnect();
				}}
				onRefresh={() => {
					void refreshScreen();
				}}
				runLiveWarning={isRunLive}
			/>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<ScreenshotPanel
					imageUrl={imageUrl}
					elements={elements}
					selection={selection}
					loading={refreshing && !imageUrl}
					disabled={!connected || running}
					onSelect={setSelection}
				/>

				<div className="flex min-h-0 flex-col gap-3">
					<CommandBar
						selection={selection}
						disabled={running}
						onAddTap={handleAddTap}
						onAddInput={handleAddInput}
						onAddSwipe={handleAddSwipe}
						onAddWait={handleAddWait}
						onClearSelection={() => setSelection(null)}
					/>
					<ScriptEditor
						value={script}
						onChange={setScript}
						disabled={running}
						activeLineNumber={activeLineNumber}
					/>
					<RunPanel
						running={running}
						canRun={connected && !running && scriptHasBody(script)}
						log={log}
						onRun={() => {
							void handleRun();
						}}
						onStop={handleStop}
						onCopy={() => {
							void handleCopy();
						}}
						onExport={handleExport}
					/>
				</div>
			</div>
		</div>
	);
}
