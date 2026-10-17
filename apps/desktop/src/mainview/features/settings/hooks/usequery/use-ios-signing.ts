import { showErrorToast } from "@/app/show-error-toast";
import {
	checkIosSigning,
	getIosSigning,
	setIosSigningTeam,
} from "@/features/settings/data/api/ios-signing";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IosSigningCheckResponse } from "@yoqa/runner-client";

const IOS_SIGNING_QUERY_KEY = ["ios-signing"] as const;

export function useIosSigning(enabled: boolean) {
	return useQuery({
		queryKey: IOS_SIGNING_QUERY_KEY,
		enabled,
		queryFn: getIosSigning,
		staleTime: 30_000,
	});
}

export function useSetIosSigningTeam(options: { onSuccess: () => void }) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: setIosSigningTeam,
		onSuccess: (status) => {
			queryClient.setQueryData(IOS_SIGNING_QUERY_KEY, status);
			options.onSuccess();
		},
		onError: (error) => showErrorToast(error, "Could not save the signing team"),
	});
}

export function useCheckIosSigning(options: {
	onSuccess: (check: IosSigningCheckResponse) => void;
}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: checkIosSigning,
		onSuccess: (check) => {
			options.onSuccess(check);
			void queryClient.invalidateQueries({ queryKey: IOS_SIGNING_QUERY_KEY });
		},
		onError: (error) => showErrorToast(error, "Could not check signing"),
	});
}
