import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import { runQueryKey, useActiveRun } from "@/features/runs/active-run-context";
import {
	type CaseLabelMeta,
	type RunListTone,
	devicesQueryKey,
	formatCaseLabel,
	formatDeviceLabel,
	formatRunDetailMeta,
	runListResult,
} from "@/features/runs/labels";
import { ScreenshotCrossfade } from "@/features/runs/screenshot-crossfade";
import { useArrivingIds, useFollowLatest } from "@/features/runs/use-follow-latest";
import { casesQueryKey, mapCatalogCase } from "@/features/test-cases/data";
import { Button, Modal, toast } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { Device, Run, RunStatus, RunStep, RunTest } from "@yoqa/runner-client";
import {
	buildRunReportFromCatalogRun,
	formatRunReportHtml,
	formatRunReportMarkdown,
	formatStepCommand,
	readStepCycle,
	actionSummary as reportActionSummary,
	stepReasoning as reportStepReasoning,
	suggestedRunReportBasename,
} from "@yoqa/runner-client";
import { useEffect, useMemo, useState } from "react";

const STEP_ROW =
	"grid grid-cols-[24px_minmax(0,1fr)] gap-3.5 border-t border-outline-variant py-3.5 first:border-t-transparent";

const LIVE_STATUSES = new Set<RunStatus>(["queued", "running"]);

const STATUS_PILL: Record<RunListTone, string> = {
	passed: "bg-secondary/12 text-on-secondary-container",
	failed: "bg-error/12 text-on-error-container",
	empty: "bg-on-surface/5 text-on-surface-variant",
	cancelled: "bg-on-surface/5 text-on-surface-variant",
	live: "bg-violet-container text-on-violet-container",
};

const STATUS_DOT: Record<RunListTone, string> = {
	passed: "bg-secondary",
	failed: "bg-error",
	empty: "bg-outline",
	cancelled: "bg-outline",
	live: "bg-violet motion-live-dot",
};

function PlayIcon() {
	return (
		<svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
			<path d="M8 5.5v13l11-6.5L8 5.5Z" />
		</svg>
	);
}

function fileSafeName(label: string): string {
	return label.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "video";
}

/** Plays one case's video in a dialog and lets the user save the file. */
function VideoDialog({
	title,
	url,
	onClose,
	onDelete,
}: {
	title: string;
	url: string | null;
	onClose: () => void;
	onDelete: () => Promise<void>;
}) {
	const [saving, setSaving] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);

	const remove = async () => {
		setDeleting(true);
		try {
			await onDelete();
			setConfirmingDelete(false);
			onClose();
		} catch (error) {
			toast.danger(error instanceof Error ? error.message : "Delete failed");
		} finally {
			setDeleting(false);
		}
	};

	const download = async () => {
		if (!url) return;
		setSaving(true);
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Download failed (${response.status})`);
			const blobUrl = URL.createObjectURL(await response.blob());
			const anchor = document.createElement("a");
			anchor.href = blobUrl;
			anchor.download = `${fileSafeName(title)}.mp4`;
			anchor.click();
			URL.revokeObjectURL(blobUrl);
		} catch (error) {
			toast.danger(error instanceof Error ? error.message : "Download failed");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal>
			<Modal.Backdrop
				isOpen={url !== null}
				onOpenChange={(next) => {
					if (next) return;
					setConfirmingDelete(false);
					onClose();
				}}
			>
				<Modal.Container placement="center" size="lg">
					<Modal.Dialog className="gap-4 p-5">
						<Modal.CloseTrigger />
						<p className="pr-8 text-body-md font-medium text-on-surface">{title}</p>
						{url ? (
							// biome-ignore lint/a11y/useMediaCaption: a device screen recording has no audio track
							<video
								autoPlay
								className="max-h-[70vh] w-full rounded-xl bg-scrim object-contain"
								controls
								src={url}
							/>
						) : null}
						{confirmingDelete ? (
							<div className="flex flex-wrap items-center justify-between gap-3">
								<p className="text-body-sm text-on-surface-variant">
									Delete this video? This cannot be undone.
								</p>
								<div className="flex gap-2">
									<Button
										isDisabled={deleting}
										onPress={() => setConfirmingDelete(false)}
										variant="secondary"
									>
										Cancel
									</Button>
									<Button isDisabled={deleting} onPress={() => void remove()} variant="danger">
										{deleting ? "Deleting…" : "Delete"}
									</Button>
								</div>
							</div>
						) : (
							<div className="flex justify-end gap-2">
								<Button onPress={() => setConfirmingDelete(true)} variant="danger-soft">
									Delete video
								</Button>
								<Button isDisabled={saving} onPress={() => void download()} variant="secondary">
									{saving ? "Downloading…" : "Download video"}
								</Button>
							</div>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

/**
 * The cases that were recorded, each as a button that opens its video. Shown only once the Run
 * has finished: while it is live (or a video is still being saved) there is nothing to show yet.
 */
function CaseVideos({
	tests,
	label,
	videoUrl,
	onDelete,
}: {
	tests: RunTest[];
	label: (test: RunTest) => string;
	videoUrl: (test: RunTest) => string | null;
	onDelete: (test: RunTest) => Promise<void>;
}) {
	const [openTestId, setOpenTestId] = useState<string | null>(null);
	const finished = tests.filter((test) => test.recording && test.recording.status !== "recording");
	if (finished.length === 0) return null;
	const openTest = finished.find((test) => test.id === openTestId);

	return (
		<div className="flex flex-col gap-3">
			<p className="text-helper font-medium text-on-surface-variant">Video</p>
			{finished.map((test) => {
				const ready = test.recording?.status === "ready";
				return ready ? (
					<button
						aria-label={`Play video: ${label(test)}`}
						className="motion-press flex w-full items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-left transition-colors data-[hovered=true]:bg-surface-container hover:bg-surface-container"
						key={test.id}
						onClick={() => setOpenTestId(test.id)}
						type="button"
					>
						<span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
							<PlayIcon />
						</span>
						<span className="flex min-w-0 flex-col">
							<span className="truncate text-body-md font-medium text-on-surface">
								{label(test)}
							</span>
							<span className="text-body-sm text-on-surface-variant">Play or download video</span>
						</span>
					</button>
				) : (
					<div
						className="rounded-2xl border border-dashed border-outline-variant px-4 py-3"
						key={test.id}
					>
						<p className="truncate text-body-md text-on-surface">{label(test)}</p>
						<p className="text-body-sm text-on-surface-variant">
							Video unavailable{test.recording?.note ? `: ${test.recording.note}` : ""}
						</p>
					</div>
				);
			})}
			<VideoDialog
				onClose={() => setOpenTestId(null)}
				onDelete={() => (openTest ? onDelete(openTest) : Promise.resolve())}
				title={openTest ? label(openTest) : ""}
				url={openTest ? videoUrl(openTest) : null}
			/>
		</div>
	);
}

function RunStatusPill({ run }: { run: Run }) {
	const result = runListResult(run);
	return (
		<span
			className={[
				"inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-xs font-medium",
				STATUS_PILL[result.tone],
			].join(" ")}
		>
			<span className={["size-1.5 rounded-full", STATUS_DOT[result.tone]].join(" ")} />
			{result.label}
		</span>
	);
}

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

function actionSummary(action: unknown): string {
	return reportActionSummary(action);
}

function stepCommandText(step: RunStep): string | null {
	return step.command ?? formatStepCommand(step.action);
}

function StepCommand({ command }: { command: string | null }) {
	if (!command) return null;
	return (
		<code
			className="max-w-full min-w-0 shrink truncate rounded-md border border-outline-variant bg-surface-container px-2 py-0.5 font-mono text-xs text-on-surface-variant"
			title={command}
		>
			{command}
		</code>
	);
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

function verifyLabel(type: string): string {
	if (type === "verify") return "Passed";
	if (type === "fail") return "Failed";
	return "Not yet";
}

function StepCycle({ action }: { action: unknown }) {
	const cycle = readStepCycle(action);
	if (!cycle) return null;
	const decision = cycle.decision ? actionSummary(cycle.decision) : "—";
	const decisionReason =
		typeof cycle.decision?.reason === "string" && cycle.decision.reason.trim()
			? cycle.decision.reason.trim()
			: null;
	const verifyTone =
		cycle.verify.type === "verify" ? "passed" : cycle.verify.type === "fail" ? "failed" : "pending";
	const verifyText = cycle.verify.reason
		? `${verifyLabel(cycle.verify.type)} — ${cycle.verify.reason}`
		: verifyLabel(cycle.verify.type);
	const verifyClass =
		verifyTone === "passed"
			? "text-on-secondary-container"
			: verifyTone === "failed"
				? "text-error"
				: "text-outline";
	const decisionText = decisionReason || decision;

	return (
		<div className="flex flex-col gap-1.5 text-[13px] leading-normal text-on-surface/80">
			<div className="flex gap-3">
				<span className="w-16 shrink-0 pt-0.5 text-[11px] font-medium tracking-[0.06em] text-outline uppercase">
					Decision
				</span>
				<span>{decisionText}</span>
			</div>
			<div className="flex gap-3">
				<span className="w-16 shrink-0 pt-0.5 text-[11px] font-medium tracking-[0.06em] text-outline uppercase">
					Verify
				</span>
				<span className={verifyClass}>{verifyText}</span>
			</div>
		</div>
	);
}

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
						className="inline-flex items-center gap-1 text-xs text-outline transition-colors hover:text-on-surface"
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

function StepNumber({
	index,
	ok,
}: {
	index: number | null;
	ok: boolean | null;
}) {
	const tone =
		ok === null
			? "bg-surface-container text-outline"
			: ok
				? "bg-secondary/15 text-on-secondary-container"
				: "bg-error/15 text-on-error-container";
	return (
		<span
			className={[
				"flex size-[22px] items-center justify-center rounded-full font-mono text-[11px] font-semibold",
				tone,
			].join(" ")}
		>
			{index ?? "…"}
		</span>
	);
}

function StepOutcome({ ok }: { ok: boolean }) {
	return (
		<span className={["text-xs", ok ? "text-on-secondary-container" : "text-error"].join(" ")}>
			{ok ? "Passed" : "Failed"}
		</span>
	);
}

function StepRow({
	step,
	index,
	selected,
	arriving,
	onSelect,
}: {
	step: RunStep;
	index: number;
	selected: boolean;
	arriving: boolean;
	onSelect: (() => void) | null;
}) {
	const { reason, thoughts } = stepReasoning(step);
	const cycle = readStepCycle(step.action);
	const showThoughts = Boolean(cycle ? thoughts : reason || thoughts);
	const heading = (
		<div className="flex min-w-0 flex-wrap items-center gap-2.5">
			<span className="text-sm font-semibold">{actionSummary(step.action)}</span>
			<StepCommand command={stepCommandText(step)} />
			<span className="min-w-2 flex-1" />
			<StepOutcome ok={step.ok} />
		</div>
	);
	const body = (
		<>
			<StepNumber index={index} ok={step.ok} />
			<div className="flex min-w-0 flex-col gap-2">
				{heading}
				<StepCycle action={step.action} />
			</div>
		</>
	);

	return (
		<li className={[STEP_ROW, arriving ? "motion-step-in" : ""].join(" ")}>
			{onSelect ? (
				<button
					aria-current={selected ? "step" : undefined}
					className="col-span-2 grid grid-cols-subgrid rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
					onClick={onSelect}
					type="button"
				>
					{body}
				</button>
			) : (
				body
			)}
			{showThoughts ? (
				<div className="col-start-2 row-start-2">
					<StepAiThoughts reason={cycle ? null : reason} thoughts={thoughts} />
				</div>
			) : null}
		</li>
	);
}

function InProgressStepRow({ command }: { command?: string | null }) {
	return (
		<li className={STEP_ROW}>
			<StepNumber index={null} ok={null} />
			<div className="flex min-w-0 flex-wrap items-center gap-2.5">
				{command ? (
					<StepCommand command={command} />
				) : (
					<span className="text-sm text-on-surface-variant">In progress…</span>
				)}
				<span className="ml-auto inline-flex items-center gap-1.5 text-xs text-on-surface-variant">
					<span className="motion-live-dot size-1.5 rounded-full bg-violet" />
					Executing…
				</span>
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
	const [videoClient, setVideoClient] = useState<{
		testUrl: (runTestId: string) => string;
	} | null>(null);
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
			// The video is finalized just after the Run's last status is saved.
			if (query.state.data?.tests.some((test) => test.recording?.status === "recording"))
				return 1000;
			return false;
		},
	});

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const client = await getRunnerClient();
			if (cancelled) return;
			setScreenshotBaseUrl(client.baseUrl);
			setVideoClient({ testUrl: (runTestId) => client.getRunTestVideoUrl(runId, runTestId) });
		})();
		return () => {
			cancelled = true;
		};
	}, [runId]);

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
	const shotIndex = shotStep ? steps.findIndex((step) => step.id === shotStep.id) : -1;
	const stepNumber = new Map(steps.map((step, index) => [step.id, index + 1]));

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
							onPress={() => cancelMutation.mutate()}
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

			<div className="flex min-h-0 flex-1 flex-wrap items-start gap-5">
				<section
					className="min-h-0 min-w-0 flex-[999] basis-[480px] overflow-y-auto rounded-xl border border-outline-variant bg-surface-container-lowest px-5 pt-1 pb-2"
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
											onSelect={reviewMode ? () => setSelectedStepId(step.id) : null}
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

				<aside className="flex w-full max-w-[360px] min-w-[280px] flex-1 flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
					<div className="flex justify-between text-xs text-outline">
						<span className="font-medium text-on-surface-variant">Screenshot</span>
						<span className="font-mono">
							{shotIndex >= 0 ? `step ${shotIndex + 1} / ${steps.length}` : "—"}
						</span>
					</div>
					<div className="relative aspect-[9/19.5] overflow-hidden rounded-[28px] border-[6px] border-outline-variant bg-surface-container">
						{screenshotUrl ? (
							<ScreenshotCrossfade
								alt={
									reviewMode
										? "Device screenshot for the selected step"
										: "Latest device screenshot from the run"
								}
								src={screenshotUrl}
							/>
						) : (
							<div className="flex h-full items-center justify-center px-5 text-center text-xs text-outline">
								{isLive
									? "Screenshot will appear as steps run"
									: shotStep
										? "No screenshot for this step"
										: "No screenshot available"}
							</div>
						)}
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
										onClick={() => setSelectedStepId(step.id)}
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
								const client = await getRunnerClient();
								await client.deleteRunTestVideo(runId, test.id);
								await queryClient.invalidateQueries({ queryKey: runQueryKey(runId) });
							}}
							tests={run.tests}
							videoUrl={(test) => videoClient?.testUrl(test.id) ?? null}
						/>
					) : null}
				</aside>
			</div>
		</div>
	);
}
