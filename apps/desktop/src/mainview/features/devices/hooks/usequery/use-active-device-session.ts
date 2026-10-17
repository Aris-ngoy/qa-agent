import { getRunnerClient } from "@/app/runner-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActiveDeviceResponse } from "@yoqa/runner-client";
import { useCallback } from "react";

export const activeDeviceSessionQueryKey = ["devices", "active"] as const;

/**
 * Shared view of the runner's Active Device Session across modes
 * (play bar, inspector). Polls while a session exists so run-held
 * transitions surface everywhere without manual refresh.
 */
export function useActiveDeviceSession() {
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: activeDeviceSessionQueryKey,
		queryFn: async (): Promise<ActiveDeviceResponse | null> => {
			const client = await getRunnerClient();
			return client.getActiveDevice();
		},
		refetchInterval: (q) => (q.state.data ? 2000 : false),
	});

	const invalidateActiveDeviceSession = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: activeDeviceSessionQueryKey });
	}, [queryClient]);

	return {
		activeSession: query.data ?? null,
		isLoading: query.isLoading,
		invalidateActiveDeviceSession,
	};
}
