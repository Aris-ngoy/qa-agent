import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import { runQueryKey, useActiveRun } from "@/features/runs/active-run-context";
import {
	type CaseLabelMeta,
	devicesQueryKey,
	formatCaseLabel,
	formatDeviceLabel,
	formatDeviceShortLabel,
} from "@/features/runs/labels";
import { casesQueryKey, mapCatalogCase } from "@/features/test-cases/data";
import { Button, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import type { Device, Run, RunStatus, RunStep } from "@yoqa/runner-client";
import {
	buildRunReportFromCatalogRun,
	formatRunReportHtml,
	formatRunReportMarkdown,
	actionSummary as reportActionSummary,
	stepReasoning as reportStepReasoning,
	suggestedRunReportBasename,
} from "@yoqa/runner-client";
import { useEffect, useMemo, useState } from "react";

const BUILD_LABELS: Record<string, string> = {
	rebuild: "Rebuild",
	skip: "Skip",
};

const LIVE_STATUSES = new Set<RunStatus>(["queued", "running"]);

function formatWhen(ms: number): string {
	const date = new Date(ms);
	const now = new Date();
	const sameDay =
		date.getFullYear() === now.getFullYear() &&
		date.getMonth() === now.getMonth() &&
		date.getDate() === now.getDate();
	const time = new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
	if (sameDay) return `Today ${time}`;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function statusLabel(status: RunStatus): string {
	switch (status) {
		case "queued":
			return "Queued";
		case "running":
			return "Running";
		case "passed":
			return "Passed";
		case "errored":
			return "Errored";
		case "cancelled":
			return "Cancelled";
	}
}

function RunStatusPill({ status }: { status: RunStatus }) {
	if (status === "passed") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-3 py-1.5 text-body-sm font-semibold text-on-secondary-container">
				<span className="size-1.5 rounded-full bg-secondary" />
				Passed
			</span>
		);
	}
	if (status === "errored") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-error-container/70 px-3 py-1.5 text-body-sm font-semibold text-on-error-container">
				<span className="size-1.5 rounded-full bg-error" />
				Errored
			</span>
		);
	}
	if (status === "cancelled") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 text-body-sm font-semibold text-on-surface-variant">
				<span className="size-1.5 rounded-full bg-on-surface-variant/60" />
				Cancelled
			</span>
		);
	}
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-primary-container/80 px-3 py-1.5 text-body-sm font-semibold text-on-primary-container">
			<span className="motion-live-dot size-1.5 rounded-full bg-primary" />
			{statusLabel(status)}
		</span>
	);
}

function actionSummary(action: unknown): string {
	return reportActionSummary(action);
}

function stepReasoning(step: RunStep): { reason: string | null; thoughts: string | null } {
	return reportStepReasoning(step);
}

function downloadTextFile(filename: string, contents: string, mime: string) {
	const blob = new Blob([contents], { type: mime });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

const TERMINAL_STATUSES = new Set<RunStatus>(["passed", "errored", "cancelled"]);

function StepAiThoughts({ reason, thoughts }: { reason: string | null; thoughts: string | null }) {
	const [open, setOpen] = useState(false);
	if (!reason && !thoughts) return null;

	const canExpand = Boolean(thoughts);

	return (
		<div className="mt-1.5">
			{reason ? <p className="text-body-sm text-on-surface-variant">{reason}</p> : null}
			{canExpand ? (
				<>
					<button
						aria-expanded={open}
						className="mt-1 inline-flex items-center gap-1 text-helper font-medium text-on-surface-variant transition-colors hover:text-on-surface"
						onClick={() => setOpen((value) => !value)}
						type="button"
					>
						<svg
							aria-hidden="true"
							className={[
								"size-3.5 transition-transform duration-[var(--motion-fast)]",
								open ? "rotate-90" : "",
							].join(" ")}
							fill="none"
							stroke="currentColor"
							strokeWidth="2"
							viewBox="0 0 24 24"
						>
							<path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						{open ? "Hide AI thoughts" : "AI thoughts"}
					</button>
					{open ? (
						<p className="mt-1.5 rounded-lg bg-surface-container/70 px-3 py-2 text-body-sm leading-relaxed text-on-surface-variant">
							{thoughts}
						</p>
					) : null}
				</>
			) : null}
		</div>
	);
}

function flattenSteps(run: Run): RunStep[] {
	const rows: RunStep[] = [];
	for (const test of run.tests) {
		for (const step of test.steps ?? []) {
			rows.push(step);
		}
	}
	return rows.sort((a, b) => a.createdAt - b.createdAt || a.idx - b.idx);
}

function latestScreenshotStep(run: Run): RunStep | null {
	let latest: RunStep | null = null;
	for (const step of flattenSteps(run)) {
		if (!step.screenshotUri) continue;
		if (!latest || step.createdAt >= latest.createdAt) {
			latest = step;
		}
	}
	return latest;
}

function firstReviewStep(run: Run): RunStep | null {
	const steps = flattenSteps(run);
	return steps.find((step) => step.screenshotUri) ?? steps[0] ?? null;
}

function StepIndicator({
	ok,
	index,
	reviewMode,
}: {
	ok: boolean;
	index: number;
	reviewMode: boolean;
}) {
	if (reviewMode && ok) {
		return (
			<span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-on-secondary">
				<svg
					aria-hidden="true"
					className="size-3.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					viewBox="0 0 24 24"
				>
					<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
		);
	}
	if (reviewMode && !ok) {
		return (
			<span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container">
				<svg
					aria-hidden="true"
					className="size-3.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					viewBox="0 0 24 24"
				>
					<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
				</svg>
			</span>
		);
	}
	return (
		<span
			className={[
				"relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full text-helper font-semibold",
				ok ? "bg-on-surface text-surface" : "bg-error-container text-on-error-container",
			].join(" ")}
		>
			{index}
		</span>
	);
}

type StepStatusKind = "completed" | "failed" | "passed" | "in_progress";

function StepStatusLabel({
	status,
	className,
}: {
	status: StepStatusKind;
	className?: string;
}) {
	const label =
		status === "completed"
			? "Completed"
			: status === "failed"
				? "Failed"
				: status === "passed"
					? "Passed"
					: "In progress…";
	const colorClass =
		status === "completed" || status === "passed"
			? "text-secondary"
			: status === "failed"
				? "text-error"
				: "text-on-surface-variant";
	return (
		<p className={[className ?? "mt-1", "text-helper font-medium", colorClass].join(" ")}>
			{label}
		</p>
	);
}

function InProgressStepRow() {
	return (
		<li className="relative flex items-start gap-3">
			<span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-container text-helper font-semibold text-on-surface-variant">
				…
			</span>
			<div className="min-w-0 flex-1">
				<StepStatusLabel className="mt-0.5" status="in_progress" />
			</div>
		</li>
	);
}

export function RunDetailPage() {
	const { runId } = useParams({ from: "/runs/$runId" });
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { setActiveRun, isRunLive, activeRunId } = useActiveRun();
	const [screenshotBaseUrl, setScreenshotBaseUrl] = useState<string | null>(null);
	const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
	const [exportingFormat, setExportingFormat] = useState<"html" | "md" | null>(null);

	useEffect(() => {
		setActiveRun(runId);
		setSelectedStepId(null);
	}, [runId, setActiveRun]);

	const runQuery = useQuery({
		queryKey: runQueryKey(runId),
		queryFn: async () => {
			const client = await getRunnerClient();
			return client.getRun(runId);
		},
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (status && LIVE_STATUSES.has(status)) return 1000;
			return false;
		},
	});

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const client = await getRunnerClient();
			if (!cancelled) setScreenshotBaseUrl(client.baseUrl);
		})();
		return () => {
			cancelled = true;
		};
	}, []);

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

	const runPlatform = runQuery.data?.platform;
	const devicesQuery = useQuery({
		queryKey: runPlatform ? devicesQueryKey(runPlatform) : (["devices", "pending"] as const),
		enabled: Boolean(runPlatform),
		queryFn: async () => {
			if (!runPlatform) return [] as Device[];
			const client = await getRunnerClient();
			const response = await client.listDevices(runPlatform, { includeUnavailable: true });
			return response.devices;
		},
		staleTime: 30_000,
	});

	const cancelMutation = useMutation({
		mutationFn: async () => {
			const client = await getRunnerClient();
			return client.cancelRun(runId);
		},
		onSuccess: (run) => {
			queryClient.setQueryData(runQueryKey(run.id), run);
			if (selectedApp) {
				void queryClient.invalidateQueries({ queryKey: casesQueryKey(selectedApp.id) });
			}
		},
	});

	const exportReport = async (format: "html" | "md") => {
		const current = runQuery.data;
		if (!current || !TERMINAL_STATUSES.has(current.status)) return;
		setExportingFormat(format);
		try {
			const client = await getRunnerClient();
			const screenshotsByStepId: Record<string, string> = {};
			const allSteps = flattenSteps(current);
			await Promise.all(
				allSteps.map(async (step) => {
					if (!step.screenshotUri) return;
					const url = client.getRunStepScreenshotUrl(current.id, step.id);
					const response = await fetch(url);
					if (!response.ok) return;
					const bytes = new Uint8Array(await response.arrayBuffer());
					screenshotsByStepId[step.id] = bytesToBase64(bytes);
				}),
			);

			const caseTitles: Record<string, string> = {};
			for (const test of current.tests) {
				caseTitles[test.caseId] = formatCaseLabel(caseNameById.get(test.caseId), test.caseId);
			}

			const deviceRow = (devicesQuery.data ?? []).find((row) => row.id === current.deviceId);
			const doc = buildRunReportFromCatalogRun(
				current,
				{
					appLabel: selectedApp?.name ?? null,
					deviceLabel: formatDeviceLabel(deviceRow, {
						deviceId: current.deviceId,
						platform: current.platform,
					}),
					caseTitles,
				},
				screenshotsByStepId,
			);

			const baseName = suggestedRunReportBasename(doc);
			if (format === "html") {
				downloadTextFile(`${baseName}.html`, formatRunReportHtml(doc), "text/html;charset=utf-8");
			} else {
				downloadTextFile(
					`${baseName}.md`,
					formatRunReportMarkdown(doc),
					"text/markdown;charset=utf-8",
				);
			}
			toast.success(format === "html" ? "HTML report exported" : "Markdown report exported");
		} catch (error) {
			showErrorToast(error, "Failed to export report");
		} finally {
			setExportingFormat(null);
		}
	};
	const run = runQuery.data;
	const isLive = run ? LIVE_STATUSES.has(run.status) : false;
	const reviewMode = Boolean(run && !isLive);

	const caseNameById = useMemo(() => {
		const map = new Map<string, CaseLabelMeta>();
		for (const item of casesQuery.data ?? []) {
			map.set(item.id, { number: item.number, name: item.name });
		}
		return map;
	}, [casesQuery.data]);

	const device = useMemo(() => {
		if (!run) return undefined;
		return (devicesQuery.data ?? []).find((row) => row.id === run.deviceId);
	}, [devicesQuery.data, run]);

	const primaryTest = run?.tests.find((t) => t.status === "running") ?? run?.tests[0] ?? null;
	const primaryCase = primaryTest ? caseNameById.get(primaryTest.caseId) : null;
	const title = primaryCase
		? formatCaseLabel(primaryCase, primaryTest?.caseId ?? "Run")
		: primaryTest
			? primaryTest.caseId
			: "Run";

	const buildLabel = run?.buildId ? (BUILD_LABELS[run.buildId] ?? run.buildId) : "App on device";
	const deviceLabel = run
		? formatDeviceShortLabel(device, { deviceId: run.deviceId, platform: run.platform })
		: "—";
	const deviceDetailLabel = run
		? formatDeviceLabel(device, { deviceId: run.deviceId, platform: run.platform })
		: null;

	const steps = useMemo(() => {
		if (!run) return [] as RunStep[];
		return flattenSteps(run);
	}, [run]);

	useEffect(() => {
		if (!run || !reviewMode) return;
		if (selectedStepId && steps.some((step) => step.id === selectedStepId)) return;
		const initial = firstReviewStep(run);
		setSelectedStepId(initial?.id ?? null);
	}, [run, reviewMode, selectedStepId, steps]);

	const shotStep = useMemo(() => {
		if (!run) return null;
		if (isLive) return latestScreenshotStep(run);
		if (selectedStepId) {
			return steps.find((step) => step.id === selectedStepId) ?? null;
		}
		return firstReviewStep(run);
	}, [run, isLive, selectedStepId, steps]);

	const screenshotUrl =
		shotStep?.screenshotUri && screenshotBaseUrl
			? `${screenshotBaseUrl}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(shotStep.id)}/screenshot`
			: null;

	const showStop = (run && LIVE_STATUSES.has(run.status)) || (activeRunId === runId && isRunLive);

	if (runQuery.isLoading && !run) {
		return (
			<div className="flex h-full items-center justify-center text-body-md text-on-surface-variant">
				Loading run…
			</div>
		);
	}

	if (runQuery.isError || !run) {
		return (
			<div className="flex h-full flex-col items-center justify-center gap-2 text-body-md text-on-surface-variant">
				<p>Could not load this run.</p>
				<p className="text-helper text-error">
					{runQuery.error instanceof Error ? runQuery.error.message : "Run not found"}
				</p>
			</div>
		);
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-5">
			<div className="motion-fade-up flex flex-wrap items-center justify-between gap-3">
				<p className="text-body-sm text-on-surface-variant">
					<Link
						className="transition-colors duration-[var(--motion-fast)] hover:text-on-surface"
						to="/runs"
					>
						Runs
					</Link>{" "}
					<span className="text-on-surface-variant/70">›</span> {buildLabel} · {deviceLabel}
				</p>
				<p className="text-body-sm text-on-surface-variant">
					{formatWhen(run.startedAt ?? run.createdAt)}
				</p>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex min-w-0 flex-wrap items-center gap-3">
					<RunStatusPill status={run.status} />
					<h1 className="truncate text-headline-md font-semibold text-on-surface">{title}</h1>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{reviewMode ? (
						<>
							<Button
								className="h-10 rounded-full px-4 shadow-none"
								isDisabled={exportingFormat !== null}
								onPress={() => {
									void exportReport("html");
								}}
								variant="secondary"
							>
								{exportingFormat === "html" ? "Exporting…" : "Export HTML"}
							</Button>
							<Button
								className="h-10 rounded-full px-4 shadow-none"
								isDisabled={exportingFormat !== null}
								onPress={() => {
									void exportReport("md");
								}}
								variant="secondary"
							>
								{exportingFormat === "md" ? "Exporting…" : "Export Markdown"}
							</Button>
						</>
					) : null}
					{showStop ? (
						<Button
							className="h-10 gap-2 rounded-full bg-error px-5 text-on-error shadow-none data-[hovered=true]:opacity-90"
							isDisabled={cancelMutation.isPending}
							onPress={() => cancelMutation.mutate()}
						>
							<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
								<rect height="12" rx="1" width="12" x="6" y="6" />
							</svg>
							Stop
						</Button>
					) : null}
				</div>
			</div>

			{deviceDetailLabel ? (
				<p className="text-body-sm text-on-surface-variant" title={run.deviceId}>
					{deviceDetailLabel}
					{device ? <span className="text-on-surface-variant/70"> · {run.deviceId}</span> : null}
				</p>
			) : null}

			{run.error ? (
				<p className="rounded-xl bg-error-container/50 px-4 py-3 text-body-sm text-on-error-container">
					{run.error}
				</p>
			) : null}

			<div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
				<section className="min-h-0 overflow-y-auto rounded-[var(--radius-platform)] bg-surface-container-lowest/80 p-5 shadow-soft">
					{run.tests.map((test, testIndex) => {
						const caseLabel = formatCaseLabel(caseNameById.get(test.caseId), test.caseId);
						const testSteps = test.steps ?? [];
						return (
							<div className="mb-8 last:mb-0" key={test.id}>
								<div className="mb-4 flex items-center gap-3">
									<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-on-surface text-body-sm font-semibold text-surface">
										{testIndex + 1}
									</span>
									<div className="min-w-0">
										<p className="truncate rounded-full bg-surface-container px-3 py-1 text-body-sm font-medium text-on-surface">
											{caseLabel}
										</p>
										<p className="mt-1 text-helper text-on-surface-variant">
											{test.status === "running"
												? "In progress…"
												: test.status === "queued"
													? "Waiting…"
													: test.status === "cancelled"
														? "Cancelled"
														: test.status === "passed"
															? "Complete"
															: (test.error ?? "Errored")}
										</p>
									</div>
								</div>

								<ul className="relative ml-3 space-y-5 before:absolute before:bottom-3 before:left-[0.6875rem] before:top-3 before:w-px before:bg-outline-variant/70">
									{testSteps.map((step) => {
										const isSelected = reviewMode && selectedStepId === step.id;
										const { reason, thoughts } = stepReasoning(step);

										if (reviewMode) {
											return (
												<li className="relative" key={step.id}>
													<div className="flex items-start gap-3">
														<button
															aria-current={isSelected ? "step" : undefined}
															className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left outline-none transition-colors hover:bg-surface-container/40 focus-visible:ring-2 focus-visible:ring-primary/40"
															onClick={() => setSelectedStepId(step.id)}
															type="button"
														>
															<StepIndicator
																index={step.idx + 1}
																ok={step.ok}
																reviewMode={reviewMode}
															/>
															<div className="min-w-0 flex-1">
																<p
																	className={[
																		"text-body-md font-medium text-on-surface",
																		isSelected
																			? "rounded-lg bg-surface-container px-2 py-1 -mx-2"
																			: "",
																	].join(" ")}
																>
																	{actionSummary(step.action)}
																</p>
																<StepStatusLabel status={step.ok ? "passed" : "failed"} />
															</div>
														</button>
													</div>
													<div className="ml-9">
														<StepAiThoughts reason={reason} thoughts={thoughts} />
													</div>
												</li>
											);
										}

										return (
											<li className="relative flex items-start gap-3" key={step.id}>
												<StepIndicator index={step.idx + 1} ok={step.ok} reviewMode={reviewMode} />
												<div className="min-w-0 flex-1">
													<p className="text-body-md font-medium text-on-surface">
														{actionSummary(step.action)}
													</p>
													<StepStatusLabel status={step.ok ? "completed" : "failed"} />
													<StepAiThoughts reason={reason} thoughts={thoughts} />
												</div>
											</li>
										);
									})}
									{test.status === "queued" || test.status === "running" ? (
										<InProgressStepRow />
									) : testSteps.length === 0 ? (
										<li className="relative flex items-start gap-3">
											<span className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-container text-helper font-semibold text-on-surface-variant">
												…
											</span>
											<p className="pt-0.5 text-body-sm text-on-surface-variant">
												No steps recorded
											</p>
										</li>
									) : null}
								</ul>
							</div>
						);
					})}

					{steps.length === 0 && run.tests.length === 0 ? (
						<p className="text-body-md text-on-surface-variant">No tests in this run.</p>
					) : null}
				</section>

				<aside className="flex min-h-[20rem] flex-col gap-3 rounded-[var(--radius-platform)] bg-surface-container-lowest/80 p-4 shadow-soft">
					<p className="text-helper font-medium text-on-surface-variant">Step screenshot</p>
					<div className="flex min-h-0 flex-1 items-start justify-center">
						{screenshotUrl ? (
							<img
								alt={
									reviewMode
										? "Device screenshot for the selected step"
										: "Latest device screenshot from the run"
								}
								className="motion-fade-in max-h-[min(70vh,40rem)] w-auto max-w-full rounded-2xl object-contain shadow-card"
								key={screenshotUrl}
								src={screenshotUrl}
							/>
						) : (
							<div className="flex flex-col items-center gap-2 px-6 text-center">
								<div className="flex size-40 items-center justify-center rounded-[2rem] border border-dashed border-outline-variant bg-surface-container/50">
									<svg
										aria-hidden="true"
										className="size-10 text-on-surface-variant/50"
										fill="none"
										stroke="currentColor"
										strokeWidth="1.5"
										viewBox="0 0 24 24"
									>
										<rect height="16" rx="2" width="10" x="7" y="4" />
										<path d="M11 17h2" strokeLinecap="round" />
									</svg>
								</div>
								<p className="text-body-sm text-on-surface-variant">
									{isLive
										? "Screenshot will appear as steps run"
										: shotStep
											? "No screenshot for this step"
											: "No screenshot available"}
								</p>
							</div>
						)}
					</div>
				</aside>
			</div>
		</div>
	);
}
