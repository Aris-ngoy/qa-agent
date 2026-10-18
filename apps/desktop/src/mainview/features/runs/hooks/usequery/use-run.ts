import { showErrorToast } from "@/app/show-error-toast";
import { activeDeviceSessionQueryKey } from "@/features/devices/hooks/usequery/use-active-device-session";
import {
	cancelRun,
	createRun,
	deleteRun,
	deleteRunTestVideo,
	getRun,
	listRuns,
	runMediaUrls,
} from "@/features/runs/data/api/runs";
import { activeRunId$, setActiveRun } from "@/features/runs/data/state/active-run";
import { isLiveRunStatus } from "@/features/runs/utils/run-status";
import { casesQueryKey } from "@/features/test-cases/hooks/usequery/use-cases";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateRunRequest, Run } from "@yoqa/runner-client";

export function runQueryKey(runId: string) {
	return ["runs", runId] as const;
}

export function runsListQueryKey(appId: string) {
	return ["runs", "list", appId] as const;
}

function runQueryOptions(runId: string | null | undefined) {
	return queryOptions({
		queryKey: runId ? runQueryKey(runId) : ["runs", "none"],
		queryFn: () => {
			if (!runId) throw new Error("No Run to load");
			return getRun(runId);
		},
	});
}

/** One Run; `refetchInterval` decides from the latest data how fast it polls. */
export function useRunQuery(
	runId: string | null | undefined,
	options: { refetchInterval?: (run: Run | undefined) => number | false } = {},
) {
	const { refetchInterval } = options;
	return useQuery({
		...runQueryOptions(runId),
		enabled: Boolean(runId),
		refetchInterval: refetchInterval ? (query) => refetchInterval(query.state.data) : undefined,
	});
}

/** The cached Run, kept current but never fetched here: the page that shows it loads it. */
export function useCachedRun(runId: string | null | undefined) {
	return useQuery({ ...runQueryOptions(runId), enabled: false }).data;
}

/** The app's Runs, polled every 2 s while one of them is live. */
export function useRunsListQuery(appId: string | null | undefined) {
	return useQuery({
		queryKey: appId ? runsListQueryKey(appId) : ["runs", "list", "none"],
		enabled: Boolean(appId),
		queryFn: () => (appId ? listRuns(appId) : Promise.resolve([] as Run[])),
		refetchInterval: (query) =>
			(query.state.data ?? []).some((run) => isLiveRunStatus(run.status)) ? 2000 : false,
	});
}

/** Screenshot and video URLs for one Run's media. */
export function useRunMediaUrls(runId: string) {
	return useQuery({
		queryKey: ["runs", runId, "media-urls"],
		queryFn: () => runMediaUrls(runId),
		staleTime: Number.POSITIVE_INFINITY,
	});
}

/**
 * Start a Run, cache it, make it the active Run, and refresh what it changes. `prepare` runs
 * first and names the Run; when it rejects (a device that cannot connect), no Run is created.
 */
export function useStartRun() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async (prepare: () => Promise<CreateRunRequest>) => createRun(await prepare()),
		onSuccess: (run) => {
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(run.appId) });
			void queryClient.invalidateQueries({ queryKey: runsListQueryKey(run.appId) });
			void queryClient.invalidateQueries({ queryKey: activeDeviceSessionQueryKey });
			queryClient.setQueryData(runQueryKey(run.id), run);
			setActiveRun(run.id);
		},
		onError: (error) => {
			showErrorToast(error, "Failed to start run");
		},
	});
}

/** Cancel a Run; the session it held and its app's cases change with it. */
export function useCancelRun() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: cancelRun,
		onSuccess: (run) => {
			queryClient.setQueryData(runQueryKey(run.id), run);
			void queryClient.invalidateQueries({ queryKey: activeDeviceSessionQueryKey });
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(run.appId) });
		},
		onError: (error) => {
			showErrorToast(error, "Failed to cancel run");
		},
	});
}

export function useDeleteRun() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteRun,
		onSuccess: (runId) => {
			queryClient.setQueriesData<Run[]>({ queryKey: ["runs", "list"] }, (current) =>
				current?.filter((run) => run.id !== runId),
			);
			queryClient.removeQueries({ queryKey: ["runs", runId] });
			if (activeRunId$.peek() === runId) setActiveRun(null);
		},
	});
}

export function useDeleteRunTestVideo(runId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (runTestId: string) => deleteRunTestVideo(runId, runTestId),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: runQueryKey(runId) }),
	});
}
