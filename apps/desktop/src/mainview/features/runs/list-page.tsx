import { getRunnerClient } from "@/app/runner-client";
import { useApps } from "@/features/apps/context";
import { useActiveRun } from "@/features/runs/active-run-context";
import { Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import type { Run } from "@yoqa/runner-client";

const BUILD_LABELS: Record<string, string> = {
	rebuild: "Rebuild",
	skip: "Skip",
};

export function runsListQueryKey(appId: string) {
	return ["runs", "list", appId] as const;
}

function formatWhen(ms: number): string {
	return new Intl.DateTimeFormat(undefined, {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(ms));
}

function buildLabel(buildId: string | null): string {
	if (!buildId) return "App on device";
	return BUILD_LABELS[buildId] ?? buildId;
}

function deviceLabel(run: Run): string {
	const os = run.platform === "ios" ? "iOS" : run.platform === "android" ? "Android" : run.platform;
	return `${run.deviceId} (${os})`;
}

function testCounts(run: Run): { total: number; passed: number; failed: number } {
	const total = run.tests.length;
	const passed = run.tests.filter((test) => test.status === "passed").length;
	const failed = run.tests.filter(
		(test) => test.status === "errored" || test.status === "cancelled",
	).length;
	return { total, passed, failed };
}

function PlatformGlyph({ platform }: { platform: Run["platform"] }) {
	if (platform === "android") {
		return (
			<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
				<path d="M17.6 9.48 19.44 6.3a.55.55 0 0 0-.95-.55l-1.9 3.29A8.1 8.1 0 0 0 12 7.75c-1.6 0-3.08.46-4.34 1.26L5.76 5.75a.55.55 0 1 0-.95.55l1.84 3.18A7.9 7.9 0 0 0 4 15.25v.5c0 .97.78 1.75 1.75 1.75h.5v2.75c0 .55.45 1 1 1s1-.45 1-1v-2.75h7.5v2.75c0 .55.45 1 1 1s1-.45 1-1v-2.75h.5c.97 0 1.75-.78 1.75-1.75v-.5c0-2.2-.9-4.18-2.4-5.52ZM8.25 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm7.5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
			</svg>
		);
	}
	return (
		<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
			<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11Z" />
		</svg>
	);
}

function TestsCell({ run }: { run: Run }) {
	const { total, passed, failed } = testCounts(run);
	if (total === 0) {
		return <span className="text-body-sm text-on-surface-variant">—</span>;
	}
	if (failed > 0) {
		return (
			<span className="text-body-sm tabular-nums text-on-surface">
				{total}{" "}
				<span className="text-on-surface-variant">
					(<span className="text-secondary">{passed}</span>
					{" / "}
					<span className="text-error">{failed}</span>)
				</span>
			</span>
		);
	}
	return (
		<span className="text-body-sm tabular-nums text-on-surface">
			{total}{" "}
			<span className="text-on-surface-variant">
				(<span className="text-secondary">{passed || total}</span>)
			</span>
		</span>
	);
}

export function RunsListPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeRunId, setActiveRun } = useActiveRun();

	const runsQuery = useQuery({
		queryKey: selectedApp ? runsListQueryKey(selectedApp.id) : ["runs", "list", "none"],
		enabled: Boolean(selectedApp),
		queryFn: async () => {
			if (!selectedApp) return [] as Run[];
			const client = await getRunnerClient();
			return client.listRuns(selectedApp.id);
		},
		refetchInterval: (query) => {
			const rows = query.state.data ?? [];
			if (rows.some((run) => run.status === "queued" || run.status === "running")) {
				return 2000;
			}
			return false;
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (runId: string) => {
			const client = await getRunnerClient();
			await client.deleteRun(runId);
			return runId;
		},
		onSuccess: (runId) => {
			if (selectedApp) {
				queryClient.setQueryData<Run[]>(runsListQueryKey(selectedApp.id), (current) =>
					(current ?? []).filter((run) => run.id !== runId),
				);
			}
			queryClient.removeQueries({ queryKey: ["runs", runId] });
			if (activeRunId === runId) {
				setActiveRun(null);
			}
		},
	});

	if (!selectedApp) {
		return (
			<div className="flex h-full items-center justify-center text-body-md text-on-surface-variant">
				Select an app to view runs.
			</div>
		);
	}

	const runs = runsQuery.data ?? [];

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-5">
			<h1 className="text-headline-md font-semibold text-on-surface">Runs</h1>

			{runsQuery.isLoading ? (
				<p className="text-body-md text-on-surface-variant">Loading runs…</p>
			) : runsQuery.isError ? (
				<p className="text-body-md text-error">
					{runsQuery.error instanceof Error ? runsQuery.error.message : "Failed to load runs"}
				</p>
			) : runs.length === 0 ? (
				<div className="rounded-[var(--radius-platform)] border border-outline-variant/60 bg-surface-container-lowest/80 px-6 py-12 text-center shadow-soft">
					<p className="text-body-md text-on-surface-variant">
						No runs yet. Select test cases and press Play to start one.
					</p>
				</div>
			) : (
				<div className="overflow-hidden rounded-[var(--radius-platform)] border border-outline-variant/60 bg-surface-container-lowest shadow-soft">
					<div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(5rem,0.7fr)_minmax(6rem,0.8fr)_2.5rem] gap-3 border-b border-outline-variant/60 px-4 py-3 text-helper font-medium text-on-surface-variant">
						<span>Build</span>
						<span>Device</span>
						<span>Tests</span>
						<span>Date</span>
						<span className="sr-only">Actions</span>
					</div>
					<ul>
						{runs.map((run) => (
							<li
								className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(5rem,0.7fr)_minmax(6rem,0.8fr)_2.5rem] items-center gap-3 border-b border-outline-variant/50 px-4 py-3.5 last:border-b-0 hover:bg-surface-container/40"
								key={run.id}
							>
								<Link
									className="flex min-w-0 items-center gap-2.5 text-body-sm font-medium text-on-surface"
									params={{ runId: run.id }}
									to="/runs/$runId"
								>
									<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant">
										<PlatformGlyph platform={run.platform} />
									</span>
									<span className="truncate">{buildLabel(run.buildId)}</span>
								</Link>
								<button
									className="flex min-w-0 items-center gap-2 text-left text-body-sm text-on-surface"
									onClick={() => void navigate({ to: "/runs/$runId", params: { runId: run.id } })}
									type="button"
								>
									<svg
										aria-hidden="true"
										className="size-4 shrink-0 text-on-surface-variant"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.75"
										viewBox="0 0 24 24"
									>
										<rect height="14" rx="2" width="16" x="4" y="5" />
										<path d="M8 19h8" strokeLinecap="round" />
									</svg>
									<span className="truncate">{deviceLabel(run)}</span>
								</button>
								<button
									className="text-left"
									onClick={() => void navigate({ to: "/runs/$runId", params: { runId: run.id } })}
									type="button"
								>
									<TestsCell run={run} />
								</button>
								<button
									className="text-left text-body-sm text-on-surface-variant"
									onClick={() => void navigate({ to: "/runs/$runId", params: { runId: run.id } })}
									type="button"
								>
									{formatWhen(run.startedAt ?? run.createdAt)}
								</button>
								<Button
									aria-label="Delete run"
									className="size-8 min-w-0 rounded-full bg-transparent p-0 text-on-surface-variant shadow-none data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
									isDisabled={deleteMutation.isPending}
									onPress={() => deleteMutation.mutate(run.id)}
									variant="ghost"
								>
									<svg
										aria-hidden="true"
										className="size-4"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.75"
										viewBox="0 0 24 24"
									>
										<path
											d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								</Button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
