import { useEnterOnce } from "@/app/motion/use-enter-once";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import type { DevicePlatform, SelectedDevice } from "@/features/devices/select-device-modal";
import { useActiveDeviceSession } from "@/features/devices/use-active-device-session";
import { CommandBar } from "@/features/inspector/command-bar";
import { tapLinesForSelection } from "@/features/inspector/command-snippets";
import { type RunLogEntry, RunPanel } from "@/features/inspector/run-panel";
import { SaveAsTestCaseDialog } from "@/features/inspector/save-as-test-case-dialog";
import { ScreenshotPanel } from "@/features/inspector/screenshot-panel";
import { ScriptEditor } from "@/features/inspector/script-editor";
import {
	type InspectorSelection,
	appendScriptLines,
	cycleChangeSelector,
	selectionFromPoint,
} from "@/features/inspector/selection";
import { SessionToolbar } from "@/features/inspector/session-toolbar";
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

/** Accessibility tree refresh when using screenshot poll (not during MJPEG). */
const TREE_REFRESH_MS = 8000;
/** Fallback screenshot poll when Appium MJPEG is unavailable. */
const FALLBACK_SCREENSHOT_MS = 250;
/** Background-refresh the cached tree if older than this on select. */
const TREE_STALE_MS = 3000;

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

function bytesToImageBlob(bytes: Uint8Array, mime = "image/png"): Blob {
	const copy = Uint8Array.from(bytes);
	return new Blob([copy.buffer], { type: mime });
}

function isDeviceSessionGone(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /device session ended|session does not exist|invalid session id|no such session|HTTP 410/i.test(
		message,
	);
}

function miniScriptFromLines(lines: string[]): string {
	return `${DEFAULT_SHELL_SCRIPT_HEADER}\n${lines.join("\n")}\n`;
}

export function InspectorPage() {
	const entered = useEnterOnce(true);
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeSession, invalidateActiveDeviceSession } = useActiveDeviceSession();

	const [platform, setPlatform] = useState<DevicePlatform>("ios");
	const [device, setDevice] = useState<SelectedDevice | null>(null);
	const [active, setActive] = useState<ActiveDeviceResponse | null>(null);
	const [connecting, setConnecting] = useState(false);
	const [bootLoading, setBootLoading] = useState(false);
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [feedMode, setFeedMode] = useState<"mjpeg" | "poll" | null>(null);
	const [liveControl, setLiveControl] = useState(false);
	const [elements, setElements] = useState<ScreenElement[]>([]);
	const [treeRefreshing, setTreeRefreshing] = useState(false);
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
	const imageIsBlobRef = useRef(false);
	const inFlightRef = useRef(false);
	const activeRef = useRef<ActiveDeviceResponse | null>(null);
	const elementsRef = useRef<ScreenElement[]>([]);
	const treeUpdatedAtRef = useRef(0);
	const selectionRef = useRef<InspectorSelection | null>(null);
	const controlWsRef = useRef<WebSocket | null>(null);
	const pointerSeqRef = useRef(0);
	/** Bumps on each connect/clear so late 410s from a dead session cannot kill the next one. */
	const sessionEpochRef = useRef(0);
	/** Device id already adopted from the shared Active Session query. */
	const adoptedDeviceIdRef = useRef<string | null>(null);
	const feedModeRef = useRef<"mjpeg" | "poll" | null>(null);
	const startLiveFeedRef = useRef<(deviceInfo: ActiveDeviceResponse) => Promise<void>>(
		async () => {},
	);

	useEffect(() => {
		activeRef.current = active;
	}, [active]);

	useEffect(() => {
		elementsRef.current = elements;
	}, [elements]);

	useEffect(() => {
		selectionRef.current = selection;
	}, [selection]);

	useEffect(() => {
		feedModeRef.current = feedMode;
	}, [feedMode]);

	const pushLog = useCallback((text: string, tone: RunLogEntry["tone"] = "info") => {
		logIdRef.current += 1;
		const id = String(logIdRef.current);
		setLog((prev) => [...prev, { id, text, tone }]);
	}, []);

	const revokeImage = useCallback(() => {
		if (imageUrlRef.current && imageIsBlobRef.current) {
			URL.revokeObjectURL(imageUrlRef.current);
		}
		imageUrlRef.current = null;
		imageIsBlobRef.current = false;
		setImageUrl(null);
	}, []);

	const setStreamImage = useCallback((url: string) => {
		if (imageUrlRef.current && imageIsBlobRef.current) {
			URL.revokeObjectURL(imageUrlRef.current);
		}
		imageUrlRef.current = url;
		imageIsBlobRef.current = false;
		setImageUrl(url);
	}, []);

	const setBlobImage = useCallback((bytes: Uint8Array) => {
		const blob = bytesToImageBlob(bytes);
		const nextUrl = URL.createObjectURL(blob);
		if (imageUrlRef.current && imageIsBlobRef.current) {
			URL.revokeObjectURL(imageUrlRef.current);
		}
		imageUrlRef.current = nextUrl;
		imageIsBlobRef.current = true;
		setImageUrl(nextUrl);
	}, []);

	const remountMjpegStream = useCallback(async () => {
		if (feedModeRef.current !== "mjpeg" || !activeRef.current) return;
		const client = await getRunnerClient();
		setStreamImage(`${client.getStreamMjpegUrl()}?t=${Date.now()}`);
	}, [setStreamImage]);

	const clearSessionUi = useCallback(() => {
		activeRef.current = null;
		setActive(null);
		setSelection(null);
		setElements([]);
		treeUpdatedAtRef.current = 0;
		setTreeRefreshing(false);
		setFeedMode(null);
		setLiveControl(false);
		controlWsRef.current?.close();
		controlWsRef.current = null;
		revokeImage();
	}, [revokeImage]);

	const handleSessionGone = useCallback(() => {
		const current = activeRef.current;
		if (current) {
			setDevice(
				(prev) =>
					prev ?? {
						id: current.deviceId,
						platform: current.platform,
						label: current.deviceId,
						name: current.deviceId,
						osVersion: "",
						kind: "physical",
					},
			);
		}
		sessionEpochRef.current += 1;
		clearSessionUi();
		invalidateActiveDeviceSession();
		notify("Device session ended — use Restart session to reconnect");
	}, [clearSessionUi, invalidateActiveDeviceSession]);

	const refreshTree = useCallback(
		async (options: { silent?: boolean } = {}): Promise<ScreenElement[] | null> => {
			const silent = options.silent ?? false;
			if (inFlightRef.current) return null;
			if (!activeRef.current) return null;
			const epoch = sessionEpochRef.current;
			const pauseMjpeg = feedModeRef.current === "mjpeg";
			inFlightRef.current = true;
			setTreeRefreshing(true);
			try {
				const client = await getRunnerClient();
				// pauseMjpeg aborts live stream proxies on the runner before pageSource
				// (Appium Inspector Element Mode — source without dual-loading WDA).
				const screen = await client.getScreen({ pauseMjpeg });
				if (sessionEpochRef.current !== epoch || !activeRef.current) return null;
				const next = screen.elements ?? [];
				setElements(next);
				treeUpdatedAtRef.current = Date.now();
				return next;
			} catch (error) {
				if (sessionEpochRef.current !== epoch) return null;
				if (isDeviceSessionGone(error)) {
					handleSessionGone();
					return null;
				}
				if (!silent) {
					showErrorToast(error, "Failed to refresh screen tree");
				}
				return null;
			} finally {
				inFlightRef.current = false;
				setTreeRefreshing(false);
				if (pauseMjpeg && sessionEpochRef.current === epoch && activeRef.current) {
					void remountMjpegStream();
				}
			}
		},
		[handleSessionGone, remountMjpegStream],
	);

	/**
	 * Warm / refresh the cached accessibility tree (pauses MJPEG briefly under Stream).
	 * Selection hit-tests locally against the cache — not on every click.
	 */
	const warmTree = useCallback(() => {
		void refreshTree({ silent: true });
	}, [refreshTree]);

	const handleLiveControlChange = useCallback(
		(enabled: boolean) => {
			setLiveControl(enabled);
			if (!enabled && activeRef.current) {
				// Entering Select mode: one pageSource warm so hover/click are instant.
				warmTree();
			}
		},
		[warmTree],
	);

	/** After a local select, refresh in the background if the cache is stale. */
	const handleSelectWithPoint = useCallback(
		(next: InspectorSelection) => {
			const age = Date.now() - treeUpdatedAtRef.current;
			if (age <= TREE_STALE_MS) return;
			void (async () => {
				const tree = await refreshTree({ silent: true });
				if (!tree) return;
				const current = selectionRef.current;
				if (!current) return;
				// Control-pick / coords-only: never snap back onto a tree node.
				if (!next.element || !current.element) return;
				// Only update if this is still the same click point the user just made.
				if (current.pointX !== next.pointX || current.pointY !== next.pointY) return;
				const refreshed = selectionFromPoint(tree, {
					x: next.pointX,
					y: next.pointY,
				});
				// Keep locator preference if the same element is still under the point.
				const sameElement =
					current.element &&
					refreshed.element &&
					(current.element.id ?? "") === (refreshed.element.id ?? "") &&
					(current.element.label ?? "") === (refreshed.element.label ?? "") &&
					current.element.x === refreshed.element.x &&
					current.element.y === refreshed.element.y;
				setSelection(
					sameElement ? { ...refreshed, preferredLocator: current.preferredLocator } : refreshed,
				);
			})();
		},
		[refreshTree],
	);

	const handleChangeSelector = useCallback(() => {
		setSelection((prev) => {
			if (!prev) return prev;
			return cycleChangeSelector(elementsRef.current, prev);
		});
	}, []);

	const handleRefreshTree = useCallback(() => {
		void refreshTree({ silent: false });
	}, [refreshTree]);
	const refreshPollFrame = useCallback(
		async (options: { includeTree?: boolean; silent?: boolean } = {}) => {
			const includeTree = options.includeTree ?? true;
			const silent = options.silent ?? false;
			if (inFlightRef.current) return;
			if (!activeRef.current) return;
			const epoch = sessionEpochRef.current;
			inFlightRef.current = true;
			if (!silent && !imageUrlRef.current) setBootLoading(true);
			try {
				const client = await getRunnerClient();
				const bytesPromise = client.fetchScreenshotBytes();
				const treePromise = includeTree ? client.getScreen() : Promise.resolve(null);
				const [bytes, screen] = await Promise.all([bytesPromise, treePromise]);
				if (sessionEpochRef.current !== epoch || !activeRef.current) return;
				setBlobImage(bytes);
				if (screen) {
					setElements(screen.elements ?? []);
					treeUpdatedAtRef.current = Date.now();
				}
			} catch (error) {
				if (sessionEpochRef.current !== epoch) return;
				if (isDeviceSessionGone(error)) {
					handleSessionGone();
					return;
				}
				if (!silent) {
					showErrorToast(error, "Failed to refresh screen");
				}
			} finally {
				inFlightRef.current = false;
				setBootLoading(false);
			}
		},
		[handleSessionGone, setBlobImage],
	);

	const startLiveFeed = useCallback(
		async (deviceInfo: ActiveDeviceResponse) => {
			setBootLoading(true);
			try {
				const client = await getRunnerClient();
				if (deviceInfo.streamReady !== false && (deviceInfo.streamUrl || deviceInfo.mjpegPort)) {
					setFeedMode("mjpeg");
					// Cache-bust so a stuck <img> MJPEG connection is remounted.
					setStreamImage(`${client.getStreamMjpegUrl()}?t=${Date.now()}`);
					// Do not page-source while MJPEG is starting — WDA dies a few seconds later.
					// Tree is loaded after script/commands (and on poll feed).
				} else {
					setFeedMode("poll");
					await refreshPollFrame({ includeTree: true, silent: false });
				}
			} catch (error) {
				showErrorToast(error, "Failed to start live feed");
				setFeedMode("poll");
				await refreshPollFrame({ includeTree: true, silent: true });
			} finally {
				setBootLoading(false);
			}
		},
		[refreshPollFrame, setStreamImage],
	);

	startLiveFeedRef.current = startLiveFeed;

	const connectWithDevice = useCallback(
		async (target: SelectedDevice) => {
			const client = await getRunnerClient();
			const bundleId =
				target.platform === "ios" ? selectedApp?.iosBundleId.trim() || undefined : undefined;
			const appPackage =
				target.platform === "android"
					? selectedApp?.androidApplicationId.trim() || undefined
					: undefined;
			const info = await client.connectDevice({
				deviceId: target.id,
				platform: target.platform,
				bundleId,
				appPackage,
			});
			sessionEpochRef.current += 1;
			activeRef.current = info;
			setActive(info);
			setSelection(null);
			setLiveControl(false);
			await startLiveFeed(info);
			invalidateActiveDeviceSession();
			return info;
		},
		[invalidateActiveDeviceSession, selectedApp, startLiveFeed],
	);

	useEffect(() => {
		const onVisibility = () => {
			setPageVisible(document.visibilityState === "visible");
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);

	// Adopt the shared Active Session (connected from any mode — play bar, CLI,
	// another inspector visit) and mirror external disconnects into local UI.
	useEffect(() => {
		if (!activeSession) {
			if (activeRef.current) {
				sessionEpochRef.current += 1;
				clearSessionUi();
			}
			return;
		}
		if (adoptedDeviceIdRef.current === activeSession.deviceId) return;
		adoptedDeviceIdRef.current = activeSession.deviceId;
		// Already showing this device locally (fresh connect) — keep the feed.
		if (activeRef.current?.deviceId === activeSession.deviceId) return;
		sessionEpochRef.current += 1;
		activeRef.current = activeSession;
		setActive(activeSession);
		setPlatform(activeSession.platform);
		void startLiveFeedRef.current(activeSession);
	}, [activeSession, clearSessionUi]);

	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			controlWsRef.current?.close();
			controlWsRef.current = null;
			revokeImage();
		};
	}, [revokeImage]);

	// Accessibility tree refresh — only on poll feed. MJPEG + pageSource on the
	// same WDA session routinely kills the stream a few seconds after connect.
	useEffect(() => {
		if (!active || !pageVisible || feedMode !== "poll") return;

		let cancelled = false;
		const tick = async () => {
			if (cancelled || !activeRef.current) return;
			await refreshTree({ silent: true });
		};

		void tick();
		const timer = window.setInterval(() => {
			void tick();
		}, TREE_REFRESH_MS);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [active, feedMode, pageVisible, refreshTree]);

	// Under Stream + Select mode, warm the tree once after connect (deferred so MJPEG can settle).
	useEffect(() => {
		if (!active || !pageVisible || feedMode !== "mjpeg" || liveControl) return;
		if (treeUpdatedAtRef.current > 0) return;
		const timer = window.setTimeout(() => {
			if (!activeRef.current || treeUpdatedAtRef.current > 0) return;
			warmTree();
		}, 700);
		return () => {
			window.clearTimeout(timer);
		};
	}, [active, feedMode, liveControl, pageVisible, warmTree]);

	// Fallback PNG poll only when MJPEG is unavailable.
	useEffect(() => {
		if (!active || !pageVisible || feedMode !== "poll") return;

		let cancelled = false;
		const tick = async () => {
			if (cancelled || !activeRef.current) return;
			await refreshPollFrame({ includeTree: false, silent: true });
		};

		void tick();
		const timer = window.setInterval(() => {
			void tick();
		}, FALLBACK_SCREENSHOT_MS);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [active, feedMode, pageVisible, refreshPollFrame]);

	// Live control WebSocket while the toggle is on.
	useEffect(() => {
		if (!active || !liveControl || !pageVisible) {
			controlWsRef.current?.close();
			controlWsRef.current = null;
			return;
		}

		let cancelled = false;
		let ws: WebSocket | null = null;

		void (async () => {
			try {
				const client = await getRunnerClient();
				if (cancelled) return;
				ws = new WebSocket(client.getControlWsUrl());
				controlWsRef.current = ws;
				ws.onclose = () => {
					if (controlWsRef.current === ws) {
						controlWsRef.current = null;
					}
				};
			} catch (error) {
				if (!cancelled) {
					showErrorToast(error, "Failed to open live control");
					setLiveControl(false);
				}
			}
		})();

		return () => {
			cancelled = true;
			ws?.close();
			if (controlWsRef.current === ws) {
				controlWsRef.current = null;
			}
		};
	}, [active, liveControl, pageVisible]);

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

	const handleConnect = useCallback(async () => {
		if (!device) return;
		setConnecting(true);
		try {
			const info = await connectWithDevice(device);
			notify(
				info.streamReady === false
					? "Connected — screenshot poll (MJPEG unavailable)"
					: "Connected — live stream on",
			);
		} catch (error) {
			showErrorToast(error, "Failed to connect device");
		} finally {
			setConnecting(false);
		}
	}, [connectWithDevice, device]);

	const handleRestartSession = useCallback(async () => {
		const target: SelectedDevice | null =
			device ??
			(active
				? {
						id: active.deviceId,
						platform: active.platform,
						label: active.deviceId,
						name: active.deviceId,
						osVersion: "",
						kind: "physical",
					}
				: null);
		if (!target) {
			showErrorToast(new Error("Select a device first"), "Nothing to restart");
			return;
		}

		setConnecting(true);
		setLiveControl(false);
		controlWsRef.current?.close();
		controlWsRef.current = null;
		try {
			const client = await getRunnerClient();
			try {
				await client.disconnectDevice();
			} catch {
				/* already dead / no session */
			}
			sessionEpochRef.current += 1;
			clearSessionUi();
			if (!device) setDevice(target);
			const info = await connectWithDevice(target);
			notify(
				info.streamReady === false
					? "Session restarted — screenshot poll"
					: "Session restarted — live stream refreshed",
			);
		} catch (error) {
			sessionEpochRef.current += 1;
			clearSessionUi();
			showErrorToast(error, "Failed to restart session");
		} finally {
			setConnecting(false);
		}
	}, [active, clearSessionUi, connectWithDevice, device]);

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
			setFeedMode(null);
			setLiveControl(false);
			controlWsRef.current?.close();
			controlWsRef.current = null;
			revokeImage();
			invalidateActiveDeviceSession();
			notify("Disconnected");
		} catch (error) {
			showErrorToast(error, "Failed to disconnect");
		} finally {
			setConnecting(false);
		}
	}, [invalidateActiveDeviceSession, revokeImage, script]);

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
				void refreshTree({ silent: true });
			}
		},
		[active, pushLog, refreshTree, running],
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
			void refreshTree({ silent: true });
		}
	}, [active, device?.name, pushLog, refreshTree, running, script, selectedApp?.name]);

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
	const live = connected && pageVisible && imageUrl != null;
	// A Run owns the shared session while live — the inspector becomes a viewer.
	const viewOnly = connected && Boolean(activeSession?.heldByRun);

	useEffect(() => {
		if (viewOnly && liveControl) {
			setLiveControl(false);
		}
	}, [viewOnly, liveControl]);
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
				onRestart={() => {
					void handleRestartSession();
				}}
				onDisconnect={() => {
					void handleDisconnect();
				}}
				viewOnly={viewOnly}
			/>

			<div className="grid grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(280px,2fr)_minmax(0,3fr)]">
				<ScreenshotPanel
					imageUrl={imageUrl}
					elements={elements}
					selection={selection}
					loading={bootLoading && !imageUrl}
					treeRefreshing={treeRefreshing}
					live={live}
					feedMode={feedMode}
					liveControl={liveControl}
					onLiveControlChange={handleLiveControlChange}
					disabled={!connected || running || viewOnly}
					snippetContext={snippetContext}
					onSelect={setSelection}
					onSelectWithPoint={handleSelectWithPoint}
					onChangeSelector={handleChangeSelector}
					onRefreshTree={handleRefreshTree}
					onDoubleTap={handleDoubleTap}
					onPointer={sendPointer}
					onInsertLines={handleInsertLines}
					onInsertAndRunLines={handleInsertAndRunLines}
					onCopyLines={(lines) => {
						void handleCopyLines(lines);
					}}
					onClearSelection={() => setSelection(null)}
				/>

				<div className="flex flex-col gap-3">
					<CommandBar
						disabled={running || viewOnly}
						onAddSwipe={handleAddSwipe}
						onAddWait={handleAddWait}
					/>
					<ScriptEditor
						value={script}
						onChange={setScript}
						disabled={running}
						activeLineNumber={activeLineNumber}
					/>
					<RunPanel
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
