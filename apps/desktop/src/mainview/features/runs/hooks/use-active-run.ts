import { activeRunId$, setActiveRun } from "@/features/runs/data/state/active-run";
import { useRunQuery } from "@/features/runs/hooks/usequery/use-run";
import { isLiveRunStatus } from "@/features/runs/utils/run-status";
import { useValue } from "@legendapp/state/react";

/** The active Run, polled while it is live. */
export function useActiveRun() {
	const activeRunId = useValue(activeRunId$);
	const runQuery = useRunQuery(activeRunId, {
		refetchInterval: (run) => (run && isLiveRunStatus(run.status) ? 1000 : false),
	});

	const status = runQuery.data?.status ?? null;
	return {
		activeRunId,
		run: runQuery.data ?? null,
		status,
		isRunLive: status != null && isLiveRunStatus(status),
		setActiveRun,
	};
}
