import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import {
	activeDeviceSessionQueryKey,
	useActiveDeviceSession,
} from "@/features/devices/use-active-device-session";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * When the user switches app in the sidebar while a device is connected and no Run holds
 * the session, point the Active Session at the new app: no reconnect, no prompt. A Run
 * that holds the session keeps reading its own app.
 */
export function useRetargetOnAppSwitch() {
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeSession } = useActiveDeviceSession();
	const sessionRef = useRef(activeSession);
	sessionRef.current = activeSession;
	/** The app the session was last pointed at by this hook (or the one selected at launch). */
	const previousAppIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!selectedApp) return;
		const previous = previousAppIdRef.current;
		previousAppIdRef.current = selectedApp.id;
		if (previous === null || previous === selectedApp.id) return;
		const session = sessionRef.current;
		if (!session || session.heldByRun) return;

		const app = selectedApp;
		void (async () => {
			try {
				const client = await getRunnerClient();
				const info = await client.retargetDevice({
					bundleId: app.iosBundleId.trim() || undefined,
					appPackage: app.androidApplicationId.trim() || undefined,
				});
				queryClient.setQueryData(activeDeviceSessionQueryKey, info);
			} catch (error) {
				showErrorToast(error, `Failed to switch the device session to ${app.name}`);
			}
		})();
	}, [selectedApp, queryClient]);
}
