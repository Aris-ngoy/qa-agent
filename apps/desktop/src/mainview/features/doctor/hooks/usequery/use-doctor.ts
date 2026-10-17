import { showErrorToast } from "@/app/show-error-toast";
import { getDoctorReport, repairDoctor } from "@/features/doctor/data/api/doctor";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const doctorQueryKey = ["doctor"] as const;

/** The doctor report; it only runs when asked (`refetch`), since a run takes a few seconds. */
export function useDoctorReport() {
	return useQuery({ queryKey: doctorQueryKey, queryFn: getDoctorReport, enabled: false });
}

/** Run the report's safe repairs and show the report they leave. */
export function useRepairDoctor() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: repairDoctor,
		onSuccess: (result) => {
			queryClient.setQueryData(doctorQueryKey, result.report);
		},
		onError: (error) => showErrorToast(error, "Repair failed"),
	});
}
