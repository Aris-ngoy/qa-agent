import { showErrorToast } from "@/app/show-error-toast";
import type { Application } from "@/features/apps/data/api/apps";
import { useApps } from "@/features/apps/hooks/use-apps";
import { retargetDevice } from "@/features/devices/data/api/devices";
import {
	activeDeviceSessionQueryKey,
	useActiveDeviceSession,
} from "@/features/devices/hooks/usequery/use-active-device-session";
import { appTargetFor, retargetsAfterRun } from "@/features/devices/utils/session-app";
import { runQueryKey } from "@/features/runs/hooks/usequery/use-run";
import { useQueryClient } from "@tanstack/react-query";
import type { ActiveDeviceResponse, Run } from "@yoqa/runner-client";
import { useCallback, useEffect, useRef } from "react";

/**
 * Keep the Active Session pointed at the app selected in the sidebar, with no reconnect and
 * no prompt: when the user switches app while no Run holds the session, and when a Run for
 * another app lets the session go. A Run that holds the session keeps reading its own app.
 */
export function useRetargetOnAppSwitch() {
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeSession } = useActiveDeviceSession();
	const sessionRef = useRef(activeSession);
	sessionRef.current = activeSession;
	const selectedAppRef = useRef(selectedApp);
	selectedAppRef.current = selectedApp;
	/** The app the session was last pointed at by this hook (or the one selected at launch). */
	const previousAppIdRef = useRef<string | null>(null);
	/** The session as last seen, to notice the moment a Run lets it go. */
	const previousSessionRef = useRef(activeSession);

	const retarget = useCallback(
		async (session: ActiveDeviceResponse, app: Application) => {
			try {
				const info = await retargetDevice(appTargetFor(session.platform, app));
				queryClient.setQueryData(activeDeviceSessionQueryKey, info);
			} catch (error) {
				showErrorToast(error, `Failed to switch the device session to ${app.name}`);
			}
		},
		[queryClient],
	);

	useEffect(() => {
		if (!selectedApp) return;
		const previous = previousAppIdRef.current;
		previousAppIdRef.current = selectedApp.id;
		if (previous === null || previous === selectedApp.id) return;
		const session = sessionRef.current;
		if (!session || session.heldByRun) return;
		void retarget(session, selectedApp);
	}, [selectedApp, retarget]);

	useEffect(() => {
		const previous = previousSessionRef.current;
		previousSessionRef.current = activeSession;
		const app = selectedAppRef.current;
		const runId = previous?.heldByRunId;
		const runAppId = runId ? queryClient.getQueryData<Run>(runQueryKey(runId))?.appId : undefined;
		if (!app || !activeSession) return;
		if (!retargetsAfterRun(previous, activeSession, runAppId, app.id)) return;
		void retarget(activeSession, app);
	}, [activeSession, queryClient, retarget]);
}
