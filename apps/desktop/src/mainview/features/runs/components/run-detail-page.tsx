import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { ResizeHandle } from "@/app/resize/resize-handle";
import { usePanelWidth } from "@/app/resize/use-panel-width";
import { useApps } from "@/features/apps/hooks/use-apps";
import { useListedDevices } from "@/features/devices/hooks/usequery/use-devices";
import { screenAspect } from "@/features/devices/utils/web-device";
import { CaseVideos } from "@/features/runs/components/case-videos";
import { RunStatusPill } from "@/features/runs/components/run-status-pill";
import {
	InProgressStepRow,
	STEP_ROW,
	StepNumber,
	StepRow,
} from "@/features/runs/components/run-step-row";
import { ScreenshotCrossfade } from "@/features/runs/components/screenshot-crossfade";
import { ScreenshotViewer } from "@/features/runs/components/screenshot-viewer";
import { useActiveRun } from "@/features/runs/hooks/use-active-run";
import { useArrivingIds, useFollowLatest } from "@/features/runs/hooks/use-follow-latest";
import { useRunReportExport } from "@/features/runs/hooks/use-run-report-export";
import {
	useCancelRun,
	useDeleteRunTestVideo,
	useRunMediaUrls,
	useRunQuery,
} from "@/features/runs/hooks/usequery/use-run";
import {
	type CaseLabelMeta,
	formatCaseLabel,
	formatRunDetailMeta,
	formatRunEnvironment,
} from "@/features/runs/utils/labels";
import { isLiveRunStatus } from "@/features/runs/utils/run-status";
import {
	firstReviewStep,
	flattenSteps,
	latestScreenshotStep,
} from "@/features/runs/utils/run-steps";
import { type Size, frameAspect } from "@/features/runs/utils/viewer-zoom";
import { useCasesQuery } from "@/features/test-cases/hooks/usequery/use-cases";
import { Button } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { useParams } from "@tanstack/react-router";
import type { RunStep } from "@yoqa/runner-client";
import { useEffect, useMemo, useRef } from "react";

/** The Screenshot panel opens at this width; the step list always keeps at least `STEPS_MIN_WIDTH`. */
const SCREENSHOT_PANEL_DEFAULT_WIDTH = 360;
const SCREENSHOT_PANEL_MIN_WIDTH = 260;
const STEPS_MIN_WIDTH = 400;
/** The splitter takes the place of the old `gap-5`. */
const HANDLE_WIDTH = 20;

function DownloadIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-[13px]"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
		</svg>
	);
}

export function RunDetailPage() {
	const { runId } = useParams({ from: "/runs/$runId" });
	const { selectedApp } = useApps();
	const { setActiveRun, isRunLive, activeRunId } = useActiveRun();
	const view$ = useObservable({
		selectedStepId: null as string | null,
		shotSize: null as Size | null,
		viewerOpen: false,
	});
	const selectedStepId = useValue(view$.selectedStepId);
	const shotSize = useValue(view$.shotSize);
	const viewerOpen = useValue(view$.viewerOpen);
	const columnsRef = useRef<HTMLDivElement>(null);
	const shotPanel = usePanelWidth({
		storageKey: "yoqa.runs.screenshotPanelWidth",
		defaultWidth: SCREENSHOT_PANEL_DEFAULT_WIDTH,
		bounds: () => ({
			min: SCREENSHOT_PANEL_MIN_WIDTH,
			max:
				(columnsRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) -
				STEPS_MIN_WIDTH -
				HANDLE_WIDTH,
		}),
	});

	useEffect(() => {
		setActiveRun(runId);
		view$.selectedStepId.set(null);
	}, [runId, setActiveRun, view$]);

	const runQuery = useRunQuery(runId, {
		refetchInterval: (run) => {
			if (run && isLiveRunStatus(run.status)) return 1000;
			// The video is finalized just after the Run's last status is saved.
			if (run?.tests.some((test) => test.recording?.status === "recording")) return 1000;
			return false;
		},
	});
	const mediaUrls = useRunMediaUrls(runId).data;
	const casesQuery = useCasesQuery(selectedApp?.id);
	const devicesQuery = useListedDevices(runQuery.data?.platform);
	const cancelMutation = useCancelRun();
	const deleteVideo = useDeleteRunTestVideo(runId);
	const { exportingFormat, exportReport: exportRunReport } = useRunReportExport();
	const exportReport = (format: "html" | "md") =>
		exportRunReport(runQuery.data, format, {
			app: selectedApp,
			caseNameById,
			devices: devicesQuery.data ?? [],
		});

	const run = runQuery.data;
	const isLive = run ? isLiveRunStatus(run.status) : false;
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

	const steps = useMemo(() => {
		if (!run) return [] as RunStep[];
		return flattenSteps(run);
	}, [run]);

	// New steps (or a command starting) move the view while the run is live, like a chat.
	const newestContent = run
		? `${steps.at(-1)?.id ?? ""}:${run.tests.map((test) => test.currentCommand ?? "").join("|")}`
		: "";
	const reducedMotion = useReducedMotion();
	const follow = useFollowLatest(isLive, `${steps.length}:${newestContent}`, !reducedMotion);
	const isArriving = useArrivingIds(
		steps.map((step) => step.id),
		Boolean(run),
	);

	useEffect(() => {
		if (!run || !reviewMode) return;
		if (selectedStepId && steps.some((step) => step.id === selectedStepId)) return;
		const initial = firstReviewStep(run);
		view$.selectedStepId.set(initial?.id ?? null);
	}, [run, reviewMode, selectedStepId, steps, view$]);

	const shotStep = useMemo(() => {
		if (!run) return null;
		if (isLive) return latestScreenshotStep(run);
		if (selectedStepId) {
			return steps.find((step) => step.id === selectedStepId) ?? null;
		}
		return firstReviewStep(run);
	}, [run, isLive, selectedStepId, steps]);

	const screenshotUrl =
		shotStep?.screenshotUri && mediaUrls ? mediaUrls.screenshot(shotStep.id) : null;

	const showStop = (run && isLiveRunStatus(run.status)) || (activeRunId === runId && isRunLive);

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

	const durationMs =
		run.startedAt != null && (run.finishedAt != null || isLive)
			? (run.finishedAt ?? Date.now()) - run.startedAt
			: null;
	const meta = formatRunDetailMeta({
		device,
		fallback: { deviceId: run.deviceId, platform: run.platform },
		at: run.startedAt ?? run.createdAt,
		stepCount: steps.length,
		durationMs,
	});
	const environment = formatRunEnvironment(run);
	/** A web Run's screenshots are its Viewport preset's shape, not a phone's. */
	const pageAspect = screenAspect(run.platform, run.viewport);
	const shotIndex = shotStep ? steps.findIndex((step) => step.id === shotStep.id) : -1;
	const stepNumber = new Map(steps.map((step, index) => [step.id, index + 1]));
	const shotRatio = frameAspect(shotSize, pageAspect);
	const shotLabel = shotIndex >= 0 ? `Step ${shotIndex + 1} of ${steps.length}` : "Screenshot";
	const showStep = (index: number) => {
		const step = steps[index];
		return reviewMode && step ? () => view$.selectedStepId.set(step.id) : undefined;
	};

	return (
		<div className="flex h-full min-h-0 w-full max-w-[1320px] flex-1 flex-col gap-5">
			<div className="flex flex-wrap items-start gap-4">
				<div className="flex min-w-[280px] flex-1 flex-col gap-2">
					<div className="flex flex-wrap items-center gap-2.5">
						<RunStatusPill run={run} />
						<h2 className="m-0 text-xl font-semibold tracking-tight text-on-surface">{title}</h2>
					</div>
					<p className="font-mono text-xs text-outline" title={run.deviceId}>
						{meta}
					</p>
					{environment ? <p className="font-mono text-xs text-outline">{environment}</p> : null}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{reviewMode ? (
						<>
							<button
								className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-low px-3 text-xs font-medium text-on-surface disabled:opacity-50"
								disabled={exportingFormat !== null}
								onClick={() => {
									void exportReport("html");
								}}
								type="button"
							>
								<DownloadIcon />
								{exportingFormat === "html" ? "Exporting…" : "Export HTML"}
							</button>
							<button
								className="inline-flex h-[30px] items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-low px-3 text-xs font-medium text-on-surface disabled:opacity-50"
								disabled={exportingFormat !== null}
								onClick={() => {
									void exportReport("md");
								}}
								type="button"
							>
								<DownloadIcon />
								{exportingFormat === "md" ? "Exporting…" : "Export Markdown"}
							</button>
						</>
					) : null}
					{showStop ? (
						<Button
							className="h-[30px] gap-1.5 rounded-lg bg-error px-3 text-xs text-on-error shadow-none data-[hovered=true]:opacity-90"
							isDisabled={cancelMutation.isPending}
							onPress={() => cancelMutation.mutate(runId)}
						>
							<svg aria-hidden="true" className="size-3.5" fill="currentColor" viewBox="0 0 24 24">
								<rect height="12" rx="1" width="12" x="6" y="6" />
							</svg>
							Stop
						</Button>
					) : null}
				</div>
			</div>

			{run.error ? (
				<p className="rounded-xl bg-error-container/50 px-4 py-3 text-body-sm text-on-error-container">
					{run.error}
				</p>
			) : null}

			<div ref={columnsRef} className="flex min-h-0 flex-1">
				<section
					className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest px-5 pt-1 pb-2"
					onKeyDown={follow.onUserScroll}
					onPointerDown={follow.onUserScroll}
					onScroll={follow.onScroll}
					onTouchStart={follow.onUserScroll}
					onWheel={follow.onUserScroll}
					ref={follow.ref}
				>
					{run.tests.map((test, testIndex) => {
						const caseLabel = formatCaseLabel(caseNameById.get(test.caseId), test.caseId);
						const testSteps = test.steps ?? [];
						return (
							<div key={test.id}>
								{run.tests.length > 1 ? (
									<p
										className={[
											"pt-3.5 text-sm font-medium text-on-surface",
											testIndex > 0 ? "border-t border-outline-variant" : "",
										].join(" ")}
									>
										{caseLabel}
									</p>
								) : null}
								{test.error ? (
									<p className="py-3 text-sm text-error">{test.error}</p>
								) : test.status === "cancelled" ? (
									<p className="py-3 text-sm text-on-surface-variant">Cancelled</p>
								) : test.status === "queued" ? (
									<p className="py-3 text-sm text-on-surface-variant">Waiting…</p>
								) : null}
								<ul>
									{testSteps.map((step) => (
										<StepRow
											arriving={isLive && isArriving(step.id)}
											index={stepNumber.get(step.id) ?? step.idx + 1}
											key={step.id}
											onSelect={reviewMode ? () => view$.selectedStepId.set(step.id) : null}
											selected={reviewMode && selectedStepId === step.id}
											step={step}
										/>
									))}
									{test.status === "queued" || test.status === "running" ? (
										<InProgressStepRow command={test.currentCommand} />
									) : testSteps.length === 0 ? (
										<li className={STEP_ROW}>
											<StepNumber index={null} ok={null} />
											<p className="text-sm text-on-surface-variant">No steps recorded</p>
										</li>
									) : null}
								</ul>
							</div>
						);
					})}

					{steps.length === 0 && run.tests.length === 0 ? (
						<p className="py-4 text-sm text-on-surface-variant">No tests in this run.</p>
					) : null}

					{isLive && !follow.following ? (
						<div className="pointer-events-none sticky bottom-0 flex justify-center pt-2">
							<Button
								className="pointer-events-auto shadow-float"
								onPress={follow.jumpToLatest}
								size="sm"
								variant="secondary"
							>
								Jump to latest ↓
							</Button>
						</div>
					) : null}
				</section>

				<ResizeHandle
					panel={shotPanel}
					edge="start"
					label="Resize screenshot panel"
					className="w-5"
				/>

				{/* Stays put while the step list scrolls beside it. */}
				<aside
					className="flex max-h-full min-h-0 shrink-0 flex-col gap-3 self-start overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest p-4"
					style={{
						width: shotPanel.width,
						maxWidth: `calc(100% - ${STEPS_MIN_WIDTH + HANDLE_WIDTH}px)`,
						minWidth: SCREENSHOT_PANEL_MIN_WIDTH,
					}}
				>
					<div className="flex justify-between text-xs text-outline">
						<span className="font-medium text-on-surface-variant">Screenshot</span>
						<span className="font-mono">
							{shotIndex >= 0 ? `step ${shotIndex + 1} / ${steps.length}` : "—"}
						</span>
					</div>
					{/* The bezel wraps a screen shaped exactly like the screenshot, so it fills edge to edge. */}
					<div
						className={[
							"group relative mx-auto shrink-0 overflow-hidden border-outline-variant bg-surface-container",
							pageAspect ? "rounded-lg border-2" : "rounded-[28px] border-[6px]",
						].join(" ")}
						style={{
							// As wide as the panel, but never taller than the window.
							width: `min(100%, calc((100vh - 18rem) * ${shotRatio}))`,
						}}
					>
						<div className="relative w-full" style={{ aspectRatio: shotRatio }}>
							{screenshotUrl ? (
								<div className="absolute inset-0">
									<ScreenshotCrossfade
										alt={
											reviewMode
												? "Device screenshot for the selected step"
												: "Latest device screenshot from the run"
										}
										onNaturalSize={(size) =>
											view$.shotSize.set((current) =>
												current?.width === size.width && current.height === size.height
													? current
													: size,
											)
										}
										src={screenshotUrl}
									/>
									<button
										aria-label="Open screenshot viewer"
										className="absolute inset-0 flex cursor-zoom-in items-start justify-end p-2 outline-none"
										onClick={() => view$.viewerOpen.set(true)}
										type="button"
									>
										<span className="inline-flex size-8 items-center justify-center rounded-lg bg-scrim/60 text-on-scrim opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
											<svg
												aria-hidden="true"
												className="size-4"
												fill="none"
												stroke="currentColor"
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth="2"
												viewBox="0 0 24 24"
											>
												<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
											</svg>
										</span>
									</button>
								</div>
							) : (
								<div className="absolute inset-0 flex items-center justify-center px-5 text-center text-xs text-outline">
									{isLive
										? "Screenshot will appear as steps run"
										: shotStep
											? "No screenshot for this step"
											: "No screenshot available"}
								</div>
							)}
						</div>
					</div>
					{reviewMode && steps.length > 0 ? (
						<div className="flex flex-wrap justify-center gap-1.5">
							{steps.map((step, index) => {
								const selected = shotStep?.id === step.id;
								return (
									<button
										aria-current={selected ? "step" : undefined}
										aria-label={`Show step ${index + 1}`}
										className={[
											"h-1 w-[18px] rounded-sm",
											selected ? "bg-primary" : "bg-outline",
										].join(" ")}
										key={step.id}
										onClick={() => view$.selectedStepId.set(step.id)}
										type="button"
									/>
								);
							})}
						</div>
					) : null}
					{reviewMode ? (
						<CaseVideos
							label={(test) => formatCaseLabel(caseNameById.get(test.caseId), test.caseId)}
							onDelete={async (test) => {
								await deleteVideo.mutateAsync(test.id);
							}}
							tests={run.tests}
							videoUrl={(test) => mediaUrls?.video(test.id) ?? null}
						/>
					) : null}
				</aside>
			</div>

			<ScreenshotViewer
				alt={reviewMode ? "Device screenshot for the selected step" : "Latest device screenshot"}
				isOpen={viewerOpen && screenshotUrl != null}
				onNext={showStep(shotIndex + 1)}
				onOpenChange={(open) => view$.viewerOpen.set(open)}
				onPrevious={shotIndex > 0 ? showStep(shotIndex - 1) : undefined}
				src={screenshotUrl}
				title={isLive ? `Latest screenshot · ${shotLabel}` : shotLabel}
			/>
		</div>
	);
}
