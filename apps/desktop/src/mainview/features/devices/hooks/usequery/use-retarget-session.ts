import { showErrorToast } from "@/app/show-error-toast";
import type { Application } from "@/features/apps/data/api/apps";
import { retargetDevice } from "@/features/devices/data/api/devices";
import { activeDeviceSessionQueryKey } from "@/features/devices/hooks/usequery/use-active-device-session";
import { appTargetFor } from "@/features/devices/utils/session-app";
import { useQueryClient } from "@tanstack/react-query";
import type { ActiveDeviceResponse } from "@yoqa/runner-client";
import { useCallback } from "react";

/**
 * Point `session` at `app` without reconnecting, and keep the Active Session query on the
 * runner's answer. A failure shows a toast.
 */
export function useRetargetSession() {
	const queryClient = useQueryClient();
	return useCallback(
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
}
