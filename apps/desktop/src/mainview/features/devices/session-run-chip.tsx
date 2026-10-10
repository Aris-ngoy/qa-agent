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

	const finished = runQuery.data ? chip.finished : 0;
	const total = runQuery.data ? chip.total : 0;
	const percent = total > 0 ? Math.round((finished / total) * 100) : 0;

	return (
		<div className="motion-fade-in flex items-center gap-3">
			<span aria-hidden="true" className="h-8 w-px bg-outline-variant" />
			<div className="flex w-52 flex-col gap-1">
				<div className="flex items-baseline justify-between text-body-sm">
					{chip.runId ? (
						<Link
							className="font-semibold text-primary hover:underline"
							params={{ runId: chip.runId }}
							to="/runs/$runId"
						>
							Running
						</Link>
					) : (
						<span className="font-semibold text-primary">Run in progress</span>
					)}
					{total > 0 ? (
						<span className="text-on-surface-variant">
							{finished} of {total} done
						</span>
					) : null}
				</div>
				<div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
					<div
						className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
						style={{ width: `${percent}%` }}
					/>
				</div>
			</div>
			{chip.runId ? (
				<button
					className="inline-flex h-10 items-center gap-2 rounded-xl border border-error/30 px-4 text-body-md font-semibold text-error transition-colors hover:bg-error-container/50 disabled:opacity-50"
					disabled={cancelMutation.isPending}
					onClick={() => {
						if (chip.runId) cancelMutation.mutate(chip.runId);
					}}
					type="button"
				>
					<span aria-hidden="true" className="size-2.5 rounded-[2px] bg-error" />
					Stop
				</button>
			) : null}
		</div>
	);
}
