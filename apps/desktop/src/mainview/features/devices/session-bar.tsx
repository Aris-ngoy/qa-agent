import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import type { DevicePlatform, SelectedDevice } from "@/features/devices/select-device-modal";
import { SessionToolbar } from "@/features/devices/session-toolbar";
import {
	activeDeviceSessionQueryKey,
	useActiveDeviceSession,
} from "@/features/devices/use-active-device-session";
import { RunControls } from "@/features/test-cases/run-controls";
import { useTestCaseSelection } from "@/features/test-cases/selection-context";
import { toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

function deviceFromSession(session: {
	deviceId: string;
	platform: DevicePlatform;
}): SelectedDevice {
	return {
		id: session.deviceId,
		platform: session.platform,
		label: session.deviceId,
		name: session.deviceId,
		osVersion: "",
		kind: "physical",
	};
}

/**
 * The one top bar for the whole app: pick a device and connect, restart or
 * disconnect the runner's Active Device Session. Pages (Inspector, runs) read
 * the session from the shared query, so nothing else owns connect/disconnect.
 */
export function SessionBar() {
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeSession, invalidateActiveDeviceSession } = useActiveDeviceSession();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const { selectedCaseIds } = useTestCaseSelection();
	const onInspector = pathname.startsWith("/inspector");
	const showRun = pathname.startsWith("/test-cases") && selectedCaseIds.length > 0;
	const [platform, setPlatform] = useState<DevicePlatform>("ios");
	const [device, setDevice] = useState<SelectedDevice | null>(null);
	const [connecting, setConnecting] = useState(false);

	// A session started anywhere (Inspector, CLI) drives the bar's platform.
	useEffect(() => {
		if (activeSession) setPlatform(activeSession.platform);
	}, [activeSession]);

	const connectTo = async (target: SelectedDevice) => {
		const client = await getRunnerClient();
		const info = await client.connectDevice({
			deviceId: target.id,
			platform: target.platform,
			bundleId:
				target.platform === "ios" ? selectedApp?.iosBundleId.trim() || undefined : undefined,
			appPackage:
				target.platform === "android"
					? selectedApp?.androidApplicationId.trim() || undefined
					: undefined,
		});
		invalidateActiveDeviceSession();
		return info;
	};

	const handleConnect = async () => {
		if (!device) return;
		setConnecting(true);
		try {
			const info = await connectTo(device);
			toast.success(
				info.streamReady === false
					? "Connected — screenshot poll (MJPEG unavailable)"
					: "Connected — live stream on",
			);
		} catch (error) {
			showErrorToast(error, "Failed to connect device");
		} finally {
			setConnecting(false);
		}
	};

	const handleRestart = async () => {
		const target = device ?? (activeSession ? deviceFromSession(activeSession) : null);
		if (!target) {
			showErrorToast(new Error("Select a device first"), "Nothing to restart");
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
			if (!device) setDevice(target);
			await connectTo(target);
			toast.success("Session restarted");
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
			<SessionToolbar
				platform={platform}
				onPlatformChange={(next) => {
					setPlatform(next);
					setDevice(null);
				}}
				device={device}
				onDeviceSelect={setDevice}
				active={activeSession}
				connecting={connecting}
				live={Boolean(activeSession) && activeSession?.streamReady !== false}
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
				canManageSession={onInspector}
			/>
			{showRun ? <RunControls /> : null}
		</header>
	);
}
