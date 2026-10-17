import {
	activeDeviceSessionQueryKey,
	useActiveDeviceSession,
} from "@/features/devices/hooks/usequery/use-active-device-session";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/** The shared Active Session, plus the cache clear the feed uses when the runner drops it. */
export function useInspectorDevice() {
	const queryClient = useQueryClient();
	const session = useActiveDeviceSession();

	const clearActiveSession = useCallback(() => {
		queryClient.setQueryData(activeDeviceSessionQueryKey, null);
		void queryClient.invalidateQueries({ queryKey: activeDeviceSessionQueryKey });
	}, [queryClient]);

	return { ...session, clearActiveSession };
}
