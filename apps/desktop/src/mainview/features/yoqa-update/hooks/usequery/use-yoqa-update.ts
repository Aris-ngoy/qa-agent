import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	checkForYoqaUpdate,
	getYoqaUpdateSettings,
	getYoqaVersion,
	restartForYoqaUpdate,
	setYoqaUpdateSettings,
} from "../../data/api/yoqa-update";
import { setYoqaUpdateStatus } from "../../data/state/yoqa-update";

export const yoqaVersionQueryKey = ["yoqa-version"] as const;
export const yoqaUpdateSettingsQueryKey = ["yoqa-update-settings"] as const;

/** The installed version and channel; fixed for the life of the process. */
export function useYoqaVersion() {
	return useQuery({
		queryKey: yoqaVersionQueryKey,
		queryFn: getYoqaVersion,
		staleTime: Number.POSITIVE_INFINITY,
	});
}

export function useCheckForYoqaUpdate() {
	return useMutation({
		mutationFn: checkForYoqaUpdate,
		onSuccess: setYoqaUpdateStatus,
	});
}

export function useRestartForYoqaUpdate() {
	return useMutation({ mutationFn: restartForYoqaUpdate });
}

/** The stored "Check for updates automatically" setting. */
export function useYoqaUpdateSettings() {
	return useQuery({ queryKey: yoqaUpdateSettingsQueryKey, queryFn: getYoqaUpdateSettings });
}

export function useSetYoqaUpdateSettings() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: setYoqaUpdateSettings,
		onSuccess: (settings) => queryClient.setQueryData(yoqaUpdateSettingsQueryKey, settings),
	});
}
