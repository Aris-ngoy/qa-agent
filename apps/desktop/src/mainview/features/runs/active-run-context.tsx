import { getRunnerClient } from "@/app/runner-client";
import { useQuery } from "@tanstack/react-query";
import type { Run, RunStatus } from "@yoqa/runner-client";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

export function runQueryKey(runId: string) {
	return ["runs", runId] as const;
}

const LIVE_STATUSES = new Set<RunStatus>(["queued", "running"]);

type ActiveRunContextValue = {
	activeRunId: string | null;
	run: Run | null;
	status: RunStatus | null;
	isRunLive: boolean;
	setActiveRun: (runId: string | null) => void;
};

const ActiveRunContext = createContext<ActiveRunContextValue | null>(null);

export function ActiveRunProvider({ children }: { children: ReactNode }) {
	const [activeRunId, setActiveRunId] = useState<string | null>(null);

	const runQuery = useQuery({
		queryKey: activeRunId ? runQueryKey(activeRunId) : ["runs", "none"],
		enabled: Boolean(activeRunId),
		queryFn: async () => {
			if (!activeRunId) throw new Error("No active run");
			const client = await getRunnerClient();
			return client.getRun(activeRunId);
		},
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (status && LIVE_STATUSES.has(status)) return 1000;
			return false;
		},
	});

	const setActiveRun = useCallback((runId: string | null) => {
		setActiveRunId(runId);
	}, []);

	const status = runQuery.data?.status ?? null;
	const isRunLive = status != null && LIVE_STATUSES.has(status);

	const value = useMemo(
		() => ({
			activeRunId,
			run: runQuery.data ?? null,
			status,
			isRunLive,
			setActiveRun,
		}),
		[activeRunId, runQuery.data, status, isRunLive, setActiveRun],
	);

	return <ActiveRunContext.Provider value={value}>{children}</ActiveRunContext.Provider>;
}

export function useActiveRun(): ActiveRunContextValue {
	const ctx = useContext(ActiveRunContext);
	if (!ctx) {
		throw new Error("useActiveRun must be used within ActiveRunProvider");
	}
	return ctx;
}
