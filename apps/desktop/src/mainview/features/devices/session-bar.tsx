import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import {
	type DevicePlatform,
	type SelectedDevice,
	fetchPlatformDevices,
	platformDevicesQueryKey,
} from "@/features/devices/select-device-modal";
import { appTargetFor } from "@/features/devices/session-app";
import {
	deviceForSession,
	pickRememberedDevice,
	readRememberedDevice,
	writeRememberedDevice,
} from "@/features/devices/session-device";
import { SessionRunChip } from "@/features/devices/session-run-chip";
import { wdaRebuildTarget } from "@/features/devices/session-status";
import { SessionToolbar } from "@/features/devices/session-toolbar";
import {
	activeDeviceSessionQueryKey,
	useActiveDeviceSession,
} from "@/features/devices/use-active-device-session";
import { useRetargetOnAppSwitch } from "@/features/devices/use-retarget-on-app-switch";
import { rebuildWebDriverAgent } from "@/features/devices/wda-setup";
import { RunControls } from "@/features/test-cases/run-controls";
import { useTestCaseSelection } from "@/features/test-cases/selection-context";
import { toast } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import type { ActiveDeviceResponse, LaneName } from "@yoqa/runner-client";
import { useCallback, useEffect, useRef, useState } from "react";

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
	const [remembered] = useState(readRememberedDevice);
	const [platform, setPlatform] = useState<DevicePlatform>(remembered?.platform ?? "ios");
	const [device, setDevice] = useState<SelectedDevice | null>(null);
	const [connecting, setConnecting] = useState(false);
	/** The remembered device is offered once, at launch; a session or a pick replaces it. */
	const rememberedPendingRef = useRef(remembered != null);

	useRetargetOnAppSwitch();

	const devicesQuery = useQuery({
		queryKey: platformDevicesQueryKey(platform),
		queryFn: () => fetchPlatformDevices(platform),
		staleTime: 30_000,
	});
	const devices = devicesQuery.data;

	// At launch, preselect the last connected device when the list still has it. Never
	// connect; a device that is gone leaves the bar on "Select device".
	useEffect(() => {
		if (!rememberedPendingRef.current || !devices) return;
		rememberedPendingRef.current = false;
		const picked = pickRememberedDevice(remembered, devices);
		if (picked) setDevice((current) => current ?? picked);
	}, [devices, remembered]);

	// A session started anywhere (desktop, CLI, a Run) drives the bar: its platform, and
	// its device by the name the device list gives it (kept picked after a disconnect).
	// Only a connect from this desktop is remembered (`connectDevice`), not an adopted one.
	const sessionDeviceId = activeSession?.deviceId;
	const sessionPlatform = activeSession?.platform;
	useEffect(() => {
		if (!sessionDeviceId || !sessionPlatform) return;
		rememberedPendingRef.current = false;
		setPlatform(sessionPlatform);
		const listed = deviceForSession(
			{ deviceId: sessionDeviceId, platform: sessionPlatform },
			sessionPlatform === platform ? devices : undefined,
		);
		if (listed) setDevice(listed);
	}, [sessionDeviceId, sessionPlatform, platform, devices]);

	const sessionDevices = activeSession?.platform === platform ? devices : undefined;
	/** The session's device from the list; null while unlisted (the bar then shows its id). */
	const sessionDevice = activeSession ? deviceForSession(activeSession, sessionDevices) : null;
	const rebuildTarget = wdaRebuildTarget(activeSession, sessionDevices);

	/**
	 * Connect `target` for the selected app; the one connect path for Connect, Restart and
	 * Run. The bar shows "Connecting…" meanwhile. Errors are the caller's to show.
	 */
	const connectDevice = useCallback(
		async (
			target: Pick<SelectedDevice, "id" | "platform">,
			lane?: LaneName,
		): Promise<ActiveDeviceResponse> => {
			setConnecting(true);
			try {
				const client = await getRunnerClient();
				const info = await client.connectDevice({
					deviceId: target.id,
					platform: target.platform,
					...appTargetFor(target.platform, selectedApp),
					...(lane ? { lane } : {}),
				});
				writeRememberedDevice({ platform: target.platform, deviceId: target.id });
				queryClient.setQueryData(activeDeviceSessionQueryKey, info);
				invalidateActiveDeviceSession();
				return info;
			} finally {
				setConnecting(false);
			}
		},
		[invalidateActiveDeviceSession, queryClient, selectedApp],
	);

	const handleConnect = async () => {
		if (!device) return;
		try {
			const info = await connectDevice(device);
			toast.success(
				info.streamReady === false
					? "Connected — screenshot poll (MJPEG unavailable)"
					: "Connected — live stream on",
			);
		} catch (error) {
			showErrorToast(error, "Failed to connect device");
		}
	};

	const handleRestart = async ({ rebuildWda }: { rebuildWda: boolean }) => {
		const target = activeSession
			? { id: activeSession.deviceId, platform: activeSession.platform }
			: device;
		if (!target) {
			showErrorToast(new Error("Select a device first"), "Nothing to restart");
			return;
		}
		// The rebuild needs the device's real kind, so it is only offered for a listed device.
		if (rebuildWda && !rebuildTarget) {
			showErrorToast(
				new Error("The device list does not have this device, so its kind is unknown"),
				"Cannot rebuild WebDriverAgent",
			);
			return;
		}
		setConnecting(true);
		try {
			const client = await getRunnerClient();
			try {
				await client.disconnectDevice();
			} catch {
				/* already dead / no session */
			}
			queryClient.setQueryData(activeDeviceSessionQueryKey, null);
			if (rebuildWda && rebuildTarget) {
				// The rebuild is for the Appium lane's WebDriverAgent, so reconnect on that lane.
				await rebuildWebDriverAgent(rebuildTarget);
				await connectDevice(target, "appium");
				toast.success("Session restarted with a rebuilt WebDriverAgent");
			} else {
				await connectDevice(target);
				toast.success("Session restarted");
			}
		} catch (error) {
			invalidateActiveDeviceSession();
			showErrorToast(error, "Failed to restart session");
		} finally {
			setConnecting(false);
		}
	};

	const handleDisconnect = async () => {
		setConnecting(true);
		try {
			const client = await getRunnerClient();
			await client.disconnectDevice();
			queryClient.setQueryData(activeDeviceSessionQueryKey, null);
			invalidateActiveDeviceSession();
			toast.success("Disconnected");
		} catch (error) {
			showErrorToast(error, "Failed to disconnect");
		} finally {
			setConnecting(false);
		}
	};

	return (
		<header className="relative z-40 flex w-full shrink-0 flex-wrap items-center justify-end gap-3 rounded-[var(--radius-platform)] bg-surface-container-lowest/90 px-5 py-3 shadow-soft backdrop-blur-md">
			<SessionRunChip />
			<SessionToolbar
				platform={platform}
				onPlatformChange={(next) => {
					rememberedPendingRef.current = false;
					setPlatform(next);
					setDevice(null);
				}}
				device={activeSession ? sessionDevice : device}
				onDeviceSelect={(selected) => {
					rememberedPendingRef.current = false;
					setDevice(selected);
				}}
				active={activeSession}
				connecting={connecting}
				live={Boolean(activeSession) && activeSession?.streamReady !== false}
				onConnect={() => {
					void handleConnect();
				}}
				onRestart={(options) => {
					void handleRestart(options);
				}}
				onDisconnect={() => {
					void handleDisconnect();
				}}
				viewOnly={Boolean(activeSession?.heldByRun)}
				offerWdaRebuild={rebuildTarget != null}
			/>
			{showRun ? (
				<RunControls connectDevice={connectDevice} connecting={connecting} device={device} />
			) : null}
		</header>
	);
}
