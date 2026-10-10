import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { runChip } from "@/features/devices/session-status";
import { useActiveDeviceSession } from "@/features/devices/use-active-device-session";
import { runQueryKey } from "@/features/runs/active-run-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

/**
 * "Running · n/m · Cancel" for the Run that holds the Active Session, on every page and
 * for Runs started anywhere (desktop, CLI, connector). Links to the Run when the runner
 * names it; otherwise it only says a Run is in progress.
 */
export function SessionRunChip() {
	const queryClient = useQueryClient();
	const { activeSession, invalidateActiveDeviceSession } = useActiveDeviceSession();
	const holderId = activeSession?.heldByRun ? (activeSession.heldByRunId ?? null) : null;

	const runQuery = useQuery({
		queryKey: holderId ? runQueryKey(holderId) : ["runs", "none"],
		enabled: Boolean(holderId),
		queryFn: async () => {
			if (!holderId) throw new Error("No Run holds the device session");
			const client = await getRunnerClient();
			return client.getRun(holderId);
		},
		refetchInterval: 1000,
	});

	const cancelMutation = useMutation({
		mutationFn: async (runId: string) => {
			const client = await getRunnerClient();
			return client.cancelRun(runId);
		},
		onSuccess: (run) => {
			queryClient.setQueryData(runQueryKey(run.id), run);
			invalidateActiveDeviceSession();
		},
		onError: (error) => {
			showErrorToast(error, "Failed to cancel run");
		},
	});

	const chip = runChip(activeSession, runQuery.data ?? null);
	if (!chip) return null;

	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-2.5 py-1 text-body-sm font-semibold text-on-secondary-container">
			{chip.runId ? (
				<>
					<Link className="hover:underline" params={{ runId: chip.runId }} to="/runs/$runId">
						{chip.label}
					</Link>
					<span aria-hidden="true">·</span>
					<button
						className="text-error hover:underline disabled:opacity-50"
						disabled={cancelMutation.isPending}
						onClick={() => {
							if (chip.runId) cancelMutation.mutate(chip.runId);
						}}
						type="button"
					>
						Cancel
					</button>
				</>
			) : (
				chip.label
			)}
		</span>
	);
}
