import { showErrorToast } from "@/app/show-error-toast";
import {
	listServers,
	restartServer,
	stopAllServers,
	stopServer,
} from "@/features/doctor/data/api/servers";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const serversQueryKey = ["servers"] as const;

/** The runner and session servers, polled every 2 s while the panel is open. */
export function useServers(open: boolean) {
	return useQuery({
		queryKey: serversQueryKey,
		queryFn: listServers,
		enabled: open,
		refetchInterval: open ? 2_000 : false,
	});
}

function useInvalidateServers() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: serversQueryKey });
}

export function useStopAllServers() {
	const invalidate = useInvalidateServers();
	return useMutation({
		mutationFn: stopAllServers,
		onSuccess: invalidate,
		onError: (error) => showErrorToast(error, "Stop all failed"),
	});
}

export function useStopServer(options: { onSuccess?: () => void } = {}) {
	const invalidate = useInvalidateServers();
	return useMutation({
		mutationFn: stopServer,
		onSuccess: async () => {
			options.onSuccess?.();
			await invalidate();
		},
		onError: (error) => showErrorToast(error, "Stop failed"),
	});
}

export function useRestartServer(options: { onSuccess?: () => void } = {}) {
	const invalidate = useInvalidateServers();
	return useMutation({
		mutationFn: restartServer,
		onSuccess: async () => {
			options.onSuccess?.();
			await invalidate();
		},
		onError: (error) => showErrorToast(error, "Restart failed"),
	});
}
