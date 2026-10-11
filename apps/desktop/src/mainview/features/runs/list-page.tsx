import { staggerStyle, useEnterOnce } from "@/app/motion/use-enter-once";
import { getRunnerClient } from "@/app/runner-client";
import { useApps } from "@/features/apps/context";
import { useActiveDeviceSession } from "@/features/devices/use-active-device-session";
import { useActiveRun } from "@/features/runs/active-run-context";
import {
	type CaseLabelMeta,
	type RunListFilter,
	type RunListTone,
	devicesQueryKey,
	filterRuns,
	formatRunCaseSummary,
	formatRunContextCaption,
	formatRunDeviceLines,
	formatRunListDate,
	runListResult,
} from "@/features/runs/labels";
import { casesQueryKey, mapCatalogCase } from "@/features/test-cases/data";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Device, Run } from "@yoqa/runner-client";
import { type ReactNode, useMemo, useState } from "react";

const BUILD_LABELS: Record<string, string> = {
	rebuild: "Rebuild",
	skip: "Skip",
};

const ROW_GRID =
	"grid grid-cols-[28px_minmax(200px,1.6fr)_minmax(200px,1.4fr)_110px_150px_36px] items-center gap-3.5 px-4";

const TONE_DOT: Record<RunListTone, string> = {
	passed: "bg-secondary ring-[3px] ring-secondary/15",
	failed: "bg-error ring-[3px] ring-error/15",
	empty: "bg-outline",
	cancelled: "bg-outline",
	live: "bg-violet motion-live-dot",
};

const TONE_CHIP: Record<RunListTone, string> = {
	passed: "bg-secondary/12 text-on-secondary-container",
	failed: "bg-error/12 text-on-error-container",
	empty: "bg-on-surface/5 text-on-surface-variant",
	cancelled: "bg-on-surface/5 text-on-surface-variant",
	live: "bg-violet-container text-on-violet-container",
};

export function runsListQueryKey(appId: string) {
	return ["runs", "list", appId] as const;
}

function buildLabel(buildId: string | null): string {
	if (!buildId) return "App on device";
	return BUILD_LABELS[buildId] ?? buildId;
}

function PlatformGlyph({ platform }: { platform: Run["platform"] }) {
	if (platform === "android") {
		return (
			<svg aria-hidden="true" className="size-[11px]" fill="currentColor" viewBox="0 0 24 24">
				<path d="M17.6 9.48 19.44 6.3a.55.55 0 0 0-.95-.55l-1.9 3.29A8.1 8.1 0 0 0 12 7.75c-1.6 0-3.08.46-4.34 1.26L5.76 5.75a.55.55 0 1 0-.95.55l1.84 3.18A7.9 7.9 0 0 0 4 15.25v.5c0 .97.78 1.75 1.75 1.75h.5v2.75c0 .55.45 1 1 1s1-.45 1-1v-2.75h7.5v2.75c0 .55.45 1 1 1s1-.45 1-1v-2.75h.5c.97 0 1.75-.78 1.75-1.75v-.5c0-2.2-.9-4.18-2.4-5.52ZM8.25 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm7.5 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
			</svg>
		);
	}
	return (
		<svg aria-hidden="true" className="size-[11px]" fill="currentColor" viewBox="0 0 24 24">
			<path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9s-2-.9-3.4-.9c-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.8 1.2 1.8 2.6 3.1 2.6 1.2-.1 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.5 1-1.4 1.3-2.8 1.4-2.8-.1 0-2.7-1-2.7-4.2zM14 5c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1 .1 2.1-.6 2.8-1.4z" />
		</svg>
	);
}

function FilterButton({
	active,
	onPress,
	children,
}: {
	active: boolean;
	onPress: () => void;
	children: ReactNode;
}) {
	return (
		<button
			aria-pressed={active}
			className={[
				"h-[26px] rounded-[6px] px-2.5",
				active ? "bg-surface-container-high text-on-surface" : "text-on-surface-variant",
			].join(" ")}
			onClick={onPress}
			type="button"
		>
			{children}
		</button>
	);
}

function RunRow({
	run,
	caseNameById,
	device,
	deleting,
	onDelete,
	index,
	stagger,
}: {
	run: Run;
	caseNameById: Map<string, CaseLabelMeta>;
	device: Device | undefined;
	deleting: boolean;
	onDelete: () => void;
	index: number;
	stagger: boolean;
}) {
	const result = runListResult(run);
	const deviceLines = formatRunDeviceLines(device, {
		deviceId: run.deviceId,
		platform: run.platform,
	});
	const testTitle = run.tests.length === 0 ? "Empty run" : formatRunCaseSummary(run, caseNameById);

	return (
		<li
			className={[
				"group relative border-t border-outline-variant transition-colors duration-[var(--motion-fast)] hover:bg-hover-surface",
				stagger ? "motion-fade-up" : "",
			].join(" ")}
			style={staggerStyle(index, stagger)}
		>
			<Link
				className={[
					ROW_GRID,
					"h-14 text-on-surface no-underline outline-none focus-visible:bg-hover-surface",
				].join(" ")}
				params={{ runId: run.id }}
				to="/runs/$runId"
			>
				<span
					aria-label={result.label}
					className={["size-2 rounded-full", TONE_DOT[result.tone]].join(" ")}
				/>
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-body-sm font-medium">{testTitle}</span>
					<span className="flex items-center gap-[5px] text-xs text-outline">
						<PlatformGlyph platform={run.platform} />
						{buildLabel(run.buildId)}
					</span>
				</span>
				<span className="flex min-w-0 flex-col">
					<span className="truncate text-body-sm text-on-surface/80">{deviceLines.title}</span>
					<span className="truncate font-mono text-[11px] text-outline" title={run.deviceId}>
						{deviceLines.meta}
					</span>
				</span>
				<span>
					<span
						className={[
							"inline-flex h-5 items-center rounded-[5px] px-[7px] font-mono text-[11px] font-medium",
							TONE_CHIP[result.tone],
						].join(" ")}
					>
						{result.chip}
					</span>
				</span>
				<span className="text-body-sm text-on-surface-variant">
					{formatRunListDate(run.startedAt ?? run.createdAt)}
				</span>
				<span className="size-8" />
			</Link>
			<button
				aria-label="Delete run"
				className="pointer-events-none absolute top-1/2 right-4 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-outline opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-hover-surface hover:text-on-surface focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-40"
				disabled={deleting}
				onClick={onDelete}
				type="button"
			>
				<svg
					aria-hidden="true"
					className="size-[15px]"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="1.8"
					viewBox="0 0 24 24"
				>
					<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
				</svg>
			</button>
		</li>
	);
}

export function RunsListPage() {
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { activeRunId, setActiveRun } = useActiveRun();
	const { activeSession } = useActiveDeviceSession();
	const [filter, setFilter] = useState<RunListFilter>("all");

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

	const casesQuery = useQuery({
		queryKey: selectedApp ? casesQueryKey(selectedApp.id) : ["catalog", "cases", "none"],
		enabled: Boolean(selectedApp),
		queryFn: async () => {
			if (!selectedApp) return [];
			const client = await getRunnerClient();
			const cases = await client.listCases(selectedApp.id);
			return cases.map((row) => mapCatalogCase(row));
		},
	});

	const devicesQuery = useQuery({
		queryKey: devicesQueryKey("all"),
		queryFn: async () => {
			const client = await getRunnerClient();
			const [ios, android] = await Promise.all([
				client.listDevices("ios", { includeUnavailable: true }),
				client.listDevices("android", { includeUnavailable: true }),
			]);
			return [...ios.devices, ...android.devices] as Device[];
		},
		staleTime: 30_000,
	});

	const caseNameById = useMemo(() => {
		const map = new Map<string, CaseLabelMeta>();
		for (const item of casesQuery.data ?? []) {
			map.set(item.id, { number: item.number, name: item.name });
		}
		return map;
	}, [casesQuery.data]);

	const deviceById = useMemo(() => {
		const map = new Map<string, Device>();
		for (const device of devicesQuery.data ?? []) {
			map.set(device.id, device);
		}
		return map;
	}, [devicesQuery.data]);

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

	const runs = runsQuery.data ?? [];
	const visible = filterRuns(runs, filter);
	const stagger = useEnterOnce(runsQuery.isSuccess && runs.length > 0);
	const caption = formatRunContextCaption(
		activeSession ? deviceById.get(activeSession.deviceId) : undefined,
	);

	if (!selectedApp) {
		return (
			<div className="motion-fade-up flex h-full items-center justify-center text-body-md text-on-surface-variant">
				Select an app to view runs.
			</div>
		);
	}

	return (
		<div className="flex min-h-0 w-full max-w-[1240px] flex-1 flex-col gap-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="flex rounded-[9px] border border-outline-variant bg-surface-container-lowest p-[3px] text-helper font-medium">
					<FilterButton active={filter === "all"} onPress={() => setFilter("all")}>
						All <span className="text-outline">{runs.length}</span>
					</FilterButton>
					<FilterButton active={filter === "passed"} onPress={() => setFilter("passed")}>
						Passed
					</FilterButton>
					<FilterButton active={filter === "failed"} onPress={() => setFilter("failed")}>
						Failed
					</FilterButton>
				</div>
				{caption ? <span className="ml-auto text-xs text-outline">{caption}</span> : null}
			</div>

			{runsQuery.isLoading ? (
				<p className="text-body-md text-on-surface-variant">Loading runs…</p>
			) : runsQuery.isError ? (
				<p className="text-body-md text-error">
					{runsQuery.error instanceof Error ? runsQuery.error.message : "Failed to load runs"}
				</p>
			) : runs.length === 0 ? (
				<div className="motion-fade-up rounded-[12px] border border-outline-variant bg-surface-container-lowest px-6 py-12 text-center">
					<p className="text-body-sm text-on-surface-variant">
						No runs yet. Select test cases and press Play to start one.
					</p>
				</div>
			) : (
				<div className="overflow-x-auto rounded-[12px] border border-outline-variant bg-surface-container-lowest">
					<div className="min-w-[780px]">
						<div
							className={[
								ROW_GRID,
								"h-10 text-[11px] font-medium tracking-[0.06em] text-outline uppercase",
							].join(" ")}
						>
							<span />
							<span>Test</span>
							<span>Device</span>
							<span>Result</span>
							<span>Date</span>
							<span className="sr-only">Actions</span>
						</div>
						{visible.length === 0 ? (
							<p className="border-t border-outline-variant px-4 py-8 text-center text-body-sm text-on-surface-variant">
								{filter === "passed" ? "No passed runs." : "No failed runs."}
							</p>
						) : (
							<ul>
								{visible.map((run, index) => (
									<RunRow
										caseNameById={caseNameById}
										deleting={deleteMutation.isPending}
										device={deviceById.get(run.deviceId)}
										index={index}
										key={run.id}
										onDelete={() => deleteMutation.mutate(run.id)}
										run={run}
										stagger={stagger}
									/>
								))}
							</ul>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
