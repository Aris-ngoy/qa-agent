import { devLog } from "@/app/dev-log";
import { showErrorToast } from "@/app/show-error-toast";
import { controlSocketUrl } from "@/features/inspector/data/api/screen";
import { InspectorFeedController } from "@/features/inspector/data/state/feed";
import { initialPageState } from "@/features/inspector/data/state/page";
import { useInspectorDevice } from "@/features/inspector/hooks/usequery/use-inspector-device";
import { inspectorSessionKey, shouldAutoAttach } from "@/features/inspector/utils/auto-attach";
import { useObservable, useObserveEffect, useValue } from "@legendapp/state/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

/** Accessibility tree refresh when using screenshot poll (not during MJPEG). */
const TREE_REFRESH_MS = 8000;
/** Fallback screenshot poll when Appium MJPEG is unavailable. */
const FALLBACK_SCREENSHOT_MS = 250;

/**
 * Feed controller, page visibility, and the timers/socket that keep the live view going.
 * The controller is created once per page visit. Timers follow the feed with
 * `useObserveEffect`, so a frame tick does not re-render the page. The Active Session
 * still comes from `useQuery`.
 */
export function useInspectorFeed(selectedAppId: string | undefined) {
	const { activeSession, clearActiveSession } = useInspectorDevice();
	const page$ = useObservable(initialPageState());

	// One controller for this page visit. Creating it in render throws the feed away on the
	// very update Connect causes, so the card snaps back to "Inspector not connected".
	const clearSessionRef = useRef(clearActiveSession);
	clearSessionRef.current = clearActiveSession;
	const controller = useMemo(
		() =>
			new InspectorFeedController({
				onSessionGone: () => {
					clearSessionRef.current();
				},
			}),
		[],
	);
	const feed$ = controller.feed$;

	const active = useValue(feed$.active);
	const controlWsRef = useRef<WebSocket | null>(null);
	const pointerSeqRef = useRef(0);
	/** Disconnect hides the feed for this Device Session only. A new session attaches again. */
	const suppressedKey = useRef<string | null>(null);

	// The Active Session lives in useQuery. Copy the two fields these observers read so a
	// query update restarts them after render, then attach the feed when a session is up.
	const heldByRun = Boolean(activeSession?.heldByRun);
	const session$ = useObservable({ deviceId: null as string | null, heldByRun: false });
	useEffect(() => {
		session$.set({
			deviceId: activeSession?.deviceId ?? null,
			heldByRun,
		});
		if (!activeSession) {
			suppressedKey.current = null;
			return;
		}
		if (
			!shouldAutoAttach({
				deviceId: activeSession.deviceId,
				connectedAt: activeSession.connectedAt,
				attachedDeviceId: feed$.active.peek()?.deviceId ?? null,
				suppressedKey: suppressedKey.current,
			})
		) {
			return;
		}
		void controller.connect(activeSession);
	}, [activeSession, heldByRun, session$, controller, feed$]);

	useEffect(() => {
		devLog("Inspector page visibility", { visibilityState: document.visibilityState });
		const onVisibility = () => {
			devLog("Inspector page visibility changed", { visibilityState: document.visibilityState });
			page$.visible.set(document.visibilityState === "visible");
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, [page$]);

	// Let go when the Active Session this feed is showing goes away: a disconnect, restart,
	// or another device from the top bar. The effect above attaches to the session that replaced it.
	useObserveEffect(
		() => {
			const attachedId = feed$.active.get()?.deviceId ?? null;
			return attachedId != null && attachedId !== session$.deviceId.get();
		},
		(event) => {
			if (event.value) controller.clear();
		},
	);

	// Switching app points the Active Session at it (top bar); the cached tree was read for
	// the previous app, so the next selection reads the Screen again.
	useEffect(() => {
		if (!selectedAppId) return;
		controller.markTreeStale();
	}, [controller, selectedAppId]);

	// Leaving the page detaches; the device session stays connected in the top bar.
	useEffect(() => {
		return () => {
			controller.clear();
		};
	}, [controller]);

	// Accessibility tree refresh — only on poll feed. MJPEG + pageSource on the
	// same WDA session routinely kills the stream a few seconds after connect.
	useObserveEffect(
		(): "off" | "run" => {
			if (feed$.active.get() == null || !page$.visible.get() || feed$.feedMode.get() !== "poll") {
				return "off";
			}
			return "run";
		},
		(event) => {
			if (event.value !== "run") return;
			const tick = () => {
				if (feed$.unreachable.peek()) return;
				void controller.refreshTree({ silent: true });
			};
			tick();
			const timer = window.setInterval(tick, TREE_REFRESH_MS);
			event.onCleanupReaction = () => window.clearInterval(timer);
		},
	);

	// Under Stream + Select mode, warm the tree once after connect (deferred so MJPEG can settle).
	useObserveEffect(
		() =>
			feed$.active.get() != null &&
			page$.visible.get() &&
			feed$.feedMode.get() === "mjpeg" &&
			!feed$.liveControl.get(),
		(event) => {
			if (!event.value || controller.treeLoaded) return;
			const timer = window.setTimeout(() => {
				if (!feed$.active.peek() || controller.treeLoaded) return;
				void controller.refreshTree({ silent: true });
			}, 1500);
			event.onCleanupReaction = () => window.clearTimeout(timer);
		},
	);

	// Fallback PNG poll only when MJPEG is unavailable.
	useObserveEffect(
		(): "off" | "paused" | "run" => {
			if (feed$.active.get() == null || feed$.feedMode.get() !== "poll") return "off";
			return page$.visible.get() ? "run" : "paused";
		},
		(event) => {
			if (event.value === "off") return;
			devLog(
				event.value === "run" ? "Screenshot poll started" : "Screenshot poll paused: page hidden",
				{
					deviceId: feed$.active.peek()?.deviceId,
					visibilityState: document.visibilityState,
				},
			);
			if (event.value !== "run") return;
			const tick = () => {
				void controller.pollTick();
			};
			tick();
			const timer = window.setInterval(tick, FALLBACK_SCREENSHOT_MS);
			event.onCleanupReaction = () => window.clearInterval(timer);
		},
	);

	// Live control WebSocket while the toggle is on.
	useObserveEffect(
		() => feed$.active.get() != null && feed$.liveControl.get() && page$.visible.get(),
		(event) => {
			if (!event.value) return;

			let cancelled = false;
			let ws: WebSocket | null = null;

			void controlSocketUrl().then(
				(url) => {
					if (cancelled) return;
					ws = new WebSocket(url);
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

			event.onCleanupReaction = () => {
				cancelled = true;
				ws?.close();
				if (controlWsRef.current === ws) {
					controlWsRef.current = null;
				}
			};
		},
	);

	const connected = active != null;
	// A Run owns the shared session while live — the inspector becomes a viewer.
	const viewOnly = connected && heldByRun;
	useObserveEffect(
		() => feed$.active.get() != null && session$.heldByRun.get() && feed$.liveControl.get(),
		(event) => {
			if (event.value) controller.setLiveControl(false);
		},
	);

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

	const handleConnect = useCallback(() => {
		if (!activeSession || feed$.active.peek()) return;
		suppressedKey.current = null;
		void controller.connect(activeSession);
	}, [activeSession, controller, feed$]);

	const handleDisconnect = useCallback(() => {
		const current = feed$.active.peek();
		if (current) suppressedKey.current = inspectorSessionKey(current.deviceId, current.connectedAt);
		controller.disconnect();
	}, [controller, feed$]);

	const handleLiveControlChange = useCallback(
		(enabled: boolean) => controller.setLiveControl(enabled),
		[controller],
	);

	const handleSelect = useCallback(
		(next: Parameters<InspectorFeedController["select"]>[0]) => controller.select(next),
		[controller],
	);

	const handleSelectWithPoint = useCallback(
		(next: Parameters<InspectorFeedController["selectWithPoint"]>[0]) => {
			void controller.selectWithPoint(next);
		},
		[controller],
	);

	const handleChangeSelector = useCallback(() => controller.cycleSelector(), [controller]);

	const handleRefreshTree = useCallback(() => {
		void controller.refreshTree({ silent: false });
	}, [controller]);

	return {
		controller,
		feed$,
		page$,
		activeSession,
		active,
		viewOnly,
		sendPointer,
		handleConnect,
		handleDisconnect,
		handleLiveControlChange,
		handleSelect,
		handleSelectWithPoint,
		handleChangeSelector,
		handleRefreshTree,
	};
}
