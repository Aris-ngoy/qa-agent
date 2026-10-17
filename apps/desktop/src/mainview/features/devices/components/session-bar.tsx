import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/hooks/use-apps";
import { SessionBarTitle } from "@/features/devices/components/session-bar-title";
import { SessionRunChip } from "@/features/devices/components/session-run-chip";
import { SessionToolbar } from "@/features/devices/components/session-toolbar";
import { TrustDeveloperDialog } from "@/features/devices/components/trust-developer-dialog";
import {
	connectDevice as connectRunnerDevice,
	disconnectDevice,
} from "@/features/devices/data/api/devices";
import {
	type ConnectTarget,
	initialSessionBarState,
} from "@/features/devices/data/state/session-bar";
import { useRetargetOnAppSwitch } from "@/features/devices/hooks/use-retarget-on-app-switch";
import {
	activeDeviceSessionQueryKey,
	useActiveDeviceSession,
} from "@/features/devices/hooks/usequery/use-active-device-session";
import { usePlatformDevices } from "@/features/devices/hooks/usequery/use-devices";
import { connectRequestFor } from "@/features/devices/utils/session-app";
import {
	deviceForSession,
	pickRememberedDevice,
	readRememberedDevice,
	writeRememberedDevice,
} from "@/features/devices/utils/session-device";
import { connectedToastMessage } from "@/features/devices/utils/session-status";
import { RunControls } from "@/features/test-cases/components/run-controls";
import { useTestCaseSelection } from "@/features/test-cases/hooks/use-test-case-selection";
import { toast } from "@heroui/react";
import { batch } from "@legendapp/state";
import { useObservable, useValue } from "@legendapp/state/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { type ActiveDeviceResponse, type LaneName, developerNotTrusted } from "@yoqa/runner-client";
import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * The one top bar for the whole app and the one place to manage the Active Session (the
 * Device Session the Inspector and Runs share): pick a device, connect, restart or
 * disconnect it from any page, and watch or cancel the Run that holds it. Pages read the
 * session from the shared query, so nothing else owns connect/disconnect.
 */
export function SessionBar() {
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeSession, invalidateActiveDeviceSession } = useActiveDeviceSession();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const { selectedCaseIds } = useTestCaseSelection();
	const showRun = pathname.startsWith("/test-cases") && selectedCaseIds.length > 0;
	const remembered = useMemo(readRememberedDevice, []);
	const bar$ = useObservable(initialSessionBarState(remembered?.platform ?? "ios"));
	const platform = useValue(bar$.platform);
	const device = useValue(bar$.device);
	const connecting = useValue(bar$.connecting);
	const untrusted = useValue(bar$.untrusted);
	/** The remembered device is offered once, at launch; a session or a pick replaces it. */
	const rememberedPendingRef = useRef(remembered != null);

	useRetargetOnAppSwitch();

	const devicesQuery = usePlatformDevices(platform);
	const devices = devicesQuery.data;

	// At launch, preselect the last connected device when the list still has it. Never
	// connect; a device that is gone leaves the bar on "Select device".
	useEffect(() => {
		if (!rememberedPendingRef.current || !devices) return;
		rememberedPendingRef.current = false;
		const picked = pickRememberedDevice(remembered, devices);
		if (picked && !bar$.device.peek()) bar$.device.set(picked);
	}, [devices, remembered, bar$]);

	// A session started anywhere (desktop, CLI, a Run) drives the bar: its platform, and
	// its device by the name the device list gives it (kept picked after a disconnect).
	// Only a connect from this desktop is remembered (`connectDevice`), not an adopted one.
	const sessionDeviceId = activeSession?.deviceId;
	const sessionPlatform = activeSession?.platform;
	const sessionViewport = activeSession?.viewport;
	useEffect(() => {
		if (!sessionDeviceId || !sessionPlatform) return;
		rememberedPendingRef.current = false;
		bar$.platform.set(sessionPlatform);
		const listed = deviceForSession(
			{ deviceId: sessionDeviceId, platform: sessionPlatform, viewport: sessionViewport },
			sessionPlatform === platform ? devices : undefined,
		);
		if (listed) bar$.device.set(listed);
	}, [sessionDeviceId, sessionPlatform, sessionViewport, platform, devices, bar$]);

	const sessionDevices = activeSession?.platform === platform ? devices : undefined;
	/** The session's device from the list; null while unlisted (the bar then shows its id). */
	const sessionDevice = activeSession ? deviceForSession(activeSession, sessionDevices) : null;

	/**
	 * Connect `target` for the selected app; the one connect path for Connect, Restart and
	 * Run. The bar shows "Connecting…" meanwhile. Errors are the caller's to show.
	 */
	const connectDevice = useCallback(
		async (target: ConnectTarget, lane?: LaneName): Promise<ActiveDeviceResponse> => {
			bar$.connecting.set(true);
			try {
				const info = await connectRunnerDevice(connectRequestFor(target, selectedApp, lane));
				writeRememberedDevice({
					platform: target.platform,
					deviceId: target.id,
					...(info.viewport ? { viewport: info.viewport } : {}),
				});
				queryClient.setQueryData(activeDeviceSessionQueryKey, info);
				invalidateActiveDeviceSession();
				return info;
			} finally {
				bar$.connecting.set(false);
			}
		},
		[invalidateActiveDeviceSession, queryClient, selectedApp, bar$],
	);

	/** A connect error: the trust steps when the iPhone must trust the developer, else a toast. */
	const reportConnectError = (error: unknown, target: ConnectTarget, fallback: string) => {
		const info = developerNotTrusted(error);
		if (info) {
			bar$.untrusted.set({ info, target });
			return;
		}
		showErrorToast(error, fallback);
	};

	const handleConnect = async () => {
		if (!device) return;
		try {
			const info = await connectDevice(device);
			toast.success(connectedToastMessage(info));
		} catch (error) {
			reportConnectError(error, device, "Failed to connect device");
		}
	};

	/** After the user trusted the developer: connect again; the build is reused, so it only launches. */
	const handleTrustedReconnect = async () => {
		if (!untrusted) return;
		try {
			const info = await connectDevice(untrusted.target);
			bar$.untrusted.set(null);
			toast.success(connectedToastMessage(info));
		} catch (error) {
			if (developerNotTrusted(error)) {
				showErrorToast(
					new Error(
						"The iPhone still does not trust the developer. Check the steps, then try again.",
					),
					"Still not trusted",
				);
				return;
			}
			bar$.untrusted.set(null);
			showErrorToast(error, "Failed to connect device");
		}
	};

	const handleRestart = async () => {
		// A browser restarts at the preset its session was connected with.
		const target: ConnectTarget | null = activeSession
			? {
					id: activeSession.deviceId,
					platform: activeSession.platform,
					viewport: activeSession.viewport,
				}
			: device;
		if (!target) {
			showErrorToast(new Error("Select a device first"), "Nothing to restart");
			return;
		}
		bar$.connecting.set(true);
		try {
			try {
				await disconnectDevice();
			} catch {
				/* already dead / no session */
			}
			queryClient.setQueryData(activeDeviceSessionQueryKey, null);
			await connectDevice(target);
			toast.success("Session restarted");
		} catch (error) {
			invalidateActiveDeviceSession();
			reportConnectError(error, target, "Failed to restart session");
		} finally {
			bar$.connecting.set(false);
		}
	};

	const handleDisconnect = async () => {
		bar$.connecting.set(true);
		try {
			await disconnectDevice();
			queryClient.setQueryData(activeDeviceSessionQueryKey, null);
			invalidateActiveDeviceSession();
			toast.success("Disconnected");
		} catch (error) {
			showErrorToast(error, "Failed to disconnect");
		} finally {
			bar$.connecting.set(false);
		}
	};

	return (
		<header className="relative z-40 flex h-[52px] w-full shrink-0 items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-lowest pr-3 pl-5">
			<SessionBarTitle />
			<SessionToolbar
				platform={platform}
				onPlatformChange={(next) => {
					rememberedPendingRef.current = false;
					batch(() => {
						bar$.platform.set(next);
						bar$.device.set(null);
					});
				}}
				device={activeSession ? sessionDevice : device}
				onDeviceSelect={(selected) => {
					rememberedPendingRef.current = false;
					bar$.device.set(selected);
				}}
				active={activeSession}
				connecting={connecting}
				onConnect={() => {
					void handleConnect();
				}}
				onRestart={() => {
					void handleRestart();
				}}
				onDisconnect={() => {
					void handleDisconnect();
				}}
				viewOnly={Boolean(activeSession?.heldByRun)}
			/>
			<SessionRunChip />
			{showRun && !activeSession?.heldByRun ? (
				<RunControls connectDevice={connectDevice} connecting={connecting} device={device} />
			) : null}
			<TrustDeveloperDialog
				onClose={() => bar$.untrusted.set(null)}
				onReconnect={() => {
					void handleTrustedReconnect();
				}}
				reconnecting={connecting}
				untrusted={untrusted?.info ?? null}
			/>
		</header>
	);
}
