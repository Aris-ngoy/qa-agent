import { useMutation, useQuery } from "@tanstack/react-query";
import {
	checkForYoqaUpdate,
	getYoqaVersion,
	restartForYoqaUpdate,
} from "../../data/api/yoqa-update";
import { setYoqaUpdateStatus } from "../../data/state/yoqa-update";

export const yoqaVersionQueryKey = ["yoqa-version"] as const;

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
