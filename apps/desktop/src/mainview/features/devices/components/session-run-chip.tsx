import { useActiveDeviceSession } from "@/features/devices/hooks/usequery/use-active-device-session";
import { runChip } from "@/features/devices/utils/session-status";
import { useCancelRun, useRunQuery } from "@/features/runs/hooks/usequery/use-run";
import { Link } from "@tanstack/react-router";

/**
 * "Running · n/m · Cancel" for the Run that holds the Active Session, on every page and
 * for Runs started anywhere (desktop, CLI, connector). Links to the Run when the runner
 * names it; otherwise it only says a Run is in progress.
 */
export function SessionRunChip() {
	const { activeSession } = useActiveDeviceSession();
	const holderId = activeSession?.heldByRun ? (activeSession.heldByRunId ?? null) : null;
	const runQuery = useRunQuery(holderId, { refetchInterval: () => 1000 });
	const cancelMutation = useCancelRun();

	const chip = runChip(activeSession, runQuery.data ?? null);
	if (!chip) return null;

	const finished = runQuery.data ? chip.finished : 0;
	const total = runQuery.data ? chip.total : 0;
	const percent = total > 0 ? Math.round((finished / total) * 100) : 0;

	return (
		<div className="motion-fade-in flex items-center gap-2">
			<span aria-hidden="true" className="h-4 w-px bg-outline-variant" />
			<div className="flex w-40 flex-col gap-1">
				<div className="flex items-baseline justify-between text-xs">
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
					className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-error/30 px-3 text-xs font-medium text-error transition-colors hover:bg-error-container/50 disabled:opacity-50"
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
