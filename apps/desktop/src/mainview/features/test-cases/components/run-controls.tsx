import { useApps } from "@/features/apps/hooks/use-apps";
import { ProfileChoice, ViewportChoice } from "@/features/devices/components/web-device-panels";
import type { SelectedDevice } from "@/features/devices/data/state/session-bar";
import { useActiveDeviceSession } from "@/features/devices/hooks/usequery/use-active-device-session";
import { hasRunTarget } from "@/features/devices/utils/session-status";
import { initialWebRunForm } from "@/features/runs/data/state/web-run-form";
import { useActiveRun } from "@/features/runs/hooks/use-active-run";
import { useCancelRun, useStartRun } from "@/features/runs/hooks/usequery/use-run";
import { runViewport, showsProfileChoice, webRunRequest } from "@/features/runs/utils/web-run";
import { useTestCaseSelection } from "@/features/test-cases/hooks/use-test-case-selection";
import { useCasesQuery } from "@/features/test-cases/hooks/usequery/use-cases";
import { AlertDialog, Button } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { useNavigate } from "@tanstack/react-router";
import type { ActiveDeviceResponse, RunExecutionMode } from "@yoqa/runner-client";
import { useMemo } from "react";

type RunControlsProps = {
	/** The device picked in the top bar, connected first when there is no Active Session. */
	device: SelectedDevice | null;
	/** The bar's connect path (it shows "Connecting…"); rejects when the device can't connect. */
	connectDevice: (device: SelectedDevice) => Promise<ActiveDeviceResponse>;
	connecting: boolean;
};

/**
 * Starts (or cancels) a run of the selected test cases on the Active Session, or on the
 * device picked in the top bar, which is connected first. A failed connect creates no Run.
 * A web Run first asks for its Viewport preset and, on a browser Yoqa launches, its profile.
 */
export function RunControls({ device, connectDevice, connecting }: RunControlsProps) {
	const navigate = useNavigate();
	const { selectedApp } = useApps();
	const { selectedCaseIds } = useTestCaseSelection();
	const { activeRunId, isRunLive } = useActiveRun();
	const { activeSession } = useActiveDeviceSession();
	const promptOpen$ = useObservable(false);
	const executionPromptOpen = useValue(promptOpen$);
	const webForm$ = useObservable(initialWebRunForm);
	const webForm = useValue(webForm$);
	const hasTarget = hasRunTarget(activeSession, device);
	// The device the Run starts on: the Active Session's, else the one picked in the bar.
	const runDevice = activeSession
		? { id: activeSession.deviceId, platform: activeSession.platform }
		: device;
	const isWebRun = runDevice?.platform === "web";

	const casesQuery = useCasesQuery(selectedApp?.id);

	const selectedCasesWithScript = useMemo(() => {
		const cases = casesQuery.data ?? [];
		const selected = new Set(selectedCaseIds);
		return cases.filter((item) => selected.has(item.id) && item.hasScript);
	}, [casesQuery.data, selectedCaseIds]);

	const hasScripts = selectedCasesWithScript.length > 0;
	const runMutation = useStartRun();
	const cancelMutation = useCancelRun();

	const startRun = (executionMode: RunExecutionMode) => {
		promptOpen$.set(false);
		runMutation.mutate(
			async () => {
				if (!selectedApp) throw new Error("Select an app first");
				if (selectedCaseIds.length === 0) throw new Error("Select at least one test case");

				if (!runDevice) throw new Error("Pick a device in the top bar first");
				const web = webRunRequest(webForm$.peek(), runDevice, activeSession);

				// No Active Session yet: connect the picked device through the bar's Connect path
				// first, at the preset the Run asks for so it adopts that session. A connect error
				// rejects here, so no Run is created for it.
				let session = activeSession;
				if (!session) {
					if (!device) throw new Error("Pick a device in the top bar first");
					session = await connectDevice(
						web.viewport ? { ...device, viewport: web.viewport } : device,
					);
				}

				return {
					appId: selectedApp.id,
					caseIds: selectedCaseIds,
					deviceId: session.deviceId,
					platform: session.platform,
					executionMode,
					...web,
				};
			},
			{
				onSuccess: (run) => {
					void navigate({ to: "/runs/$runId", params: { runId: run.id } });
				},
			},
		);
	};

	const canRun = Boolean(
		selectedApp &&
			hasTarget &&
			!activeSession?.heldByRun &&
			selectedCaseIds.length > 0 &&
			!runMutation.isPending &&
			!connecting &&
			!isRunLive,
	);
	const runTitle = isRunLive
		? "Cancel run"
		: runMutation.isPending
			? connecting
				? "Connecting…"
				: "Starting run…"
			: !selectedApp
				? "Select an app to run"
				: selectedCaseIds.length === 0
					? "Select test cases to run"
					: !hasTarget
						? "Pick a device in the top bar to run"
						: `Run ${selectedCaseIds.length} test${selectedCaseIds.length === 1 ? "" : "s"}`;

	const onPrimaryClick = () => {
		if (isRunLive) {
			if (activeRunId) cancelMutation.mutate(activeRunId);
			return;
		}
		if (hasScripts || isWebRun) {
			// Each Run starts from the defaults: the session's preset and the Kept profile.
			webForm$.set(initialWebRunForm());
			promptOpen$.set(true);
			return;
		}
		// No saved scripts → AI agent by default.
		startRun("agent");
	};

	return (
		<>
			<button
				aria-label={isRunLive ? "Cancel run" : "Run tests"}
				className={[
					"motion-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-semibold disabled:opacity-40",
					isRunLive ? "bg-error text-on-error" : "bg-inverse-surface text-inverse-on-surface",
				].join(" ")}
				disabled={isRunLive ? cancelMutation.isPending : !canRun}
				onClick={onPrimaryClick}
				title={runTitle}
				type="button"
			>
				{isRunLive ? (
					<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
						<rect height="12" rx="1.5" width="12" x="6" y="6" />
					</svg>
				) : (
					<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
						<path d="M8 5.5v13l11-6.5L8 5.5Z" />
					</svg>
				)}
				{isRunLive ? "Stop" : "Run test"}
			</button>

			<AlertDialog>
				<AlertDialog.Backdrop
					isOpen={executionPromptOpen}
					onOpenChange={(open) => promptOpen$.set(open)}
				>
					<AlertDialog.Container>
						<AlertDialog.Dialog className="sm:max-w-[420px]">
							<AlertDialog.CloseTrigger />
							<AlertDialog.Header>
								<AlertDialog.Heading>
									{hasScripts ? "How should we run?" : "Start the run"}
								</AlertDialog.Heading>
							</AlertDialog.Header>
							<AlertDialog.Body className="flex flex-col gap-5">
								{hasScripts ? (
									<p>
										{selectedCasesWithScript.length === 1
											? "This test case has a saved script from a previous successful run."
											: `${selectedCasesWithScript.length} selected test cases have saved scripts.`}{" "}
										Use the script for a fast replay without AI, or run with the AI agent instead.
									</p>
								) : null}
								{runDevice && isWebRun ? (
									<>
										<ViewportChoice
											hint="A session at the other preset reopens at this one for the Run."
											onChange={(viewport) => webForm$.set((prev) => ({ ...prev, viewport }))}
											value={runViewport(webForm, runDevice, activeSession)}
										/>
										{showsProfileChoice(runDevice) ? (
											<ProfileChoice
												onChange={(profile) => webForm$.set((prev) => ({ ...prev, profile }))}
												value={webForm.profile}
											/>
										) : null}
									</>
								) : null}
							</AlertDialog.Body>
							<AlertDialog.Footer className="flex flex-wrap gap-2">
								<Button onPress={() => promptOpen$.set(false)} slot="close" variant="tertiary">
									Cancel
								</Button>
								{hasScripts ? (
									<>
										<Button
											isDisabled={runMutation.isPending}
											onPress={() => startRun("agent")}
											variant="secondary"
										>
											Use AI agent
										</Button>
										<Button
											isDisabled={runMutation.isPending}
											onPress={() => startRun("script")}
											variant="primary"
										>
											Use saved scripts
										</Button>
									</>
								) : (
									<Button
										isDisabled={runMutation.isPending}
										onPress={() => startRun("agent")}
										variant="primary"
									>
										Run
									</Button>
								)}
							</AlertDialog.Footer>
						</AlertDialog.Dialog>
					</AlertDialog.Container>
				</AlertDialog.Backdrop>
			</AlertDialog>
		</>
	);
}
