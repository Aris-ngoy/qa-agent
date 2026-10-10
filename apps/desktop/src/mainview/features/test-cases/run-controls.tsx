import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import type { SelectedDevice } from "@/features/devices/select-device-modal";
import { runTarget } from "@/features/devices/session-status";
import { useActiveDeviceSession } from "@/features/devices/use-active-device-session";
import { runQueryKey, useActiveRun } from "@/features/runs/active-run-context";
import { runsListQueryKey } from "@/features/runs/list-page";
import { type TestCase, casesQueryKey, mapCatalogCase } from "@/features/test-cases/data";
import { useTestCaseSelection } from "@/features/test-cases/selection-context";
import { AlertDialog, Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ActiveDeviceResponse, RunExecutionMode } from "@yoqa/runner-client";
import { useMemo, useState } from "react";

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
 */
export function RunControls({ device, connectDevice, connecting }: RunControlsProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { selectedCaseIds } = useTestCaseSelection();
	const { activeRunId, isRunLive, setActiveRun } = useActiveRun();
	const { activeSession, invalidateActiveDeviceSession } = useActiveDeviceSession();
	const [executionPromptOpen, setExecutionPromptOpen] = useState(false);
	const target = runTarget(activeSession, device);

	const casesQuery = useQuery({
		queryKey: selectedApp ? casesQueryKey(selectedApp.id) : ["catalog", "cases", "none"],
		enabled: Boolean(selectedApp),
		queryFn: async () => {
			if (!selectedApp) return [] as TestCase[];
			const client = await getRunnerClient();
			const cases = await client.listCases(selectedApp.id);
			return cases.map((row) => mapCatalogCase(row));
		},
	});

	const selectedCasesWithScript = useMemo(() => {
		const cases = casesQuery.data ?? [];
		const selected = new Set(selectedCaseIds);
		return cases.filter((item) => selected.has(item.id) && item.hasScript);
	}, [casesQuery.data, selectedCaseIds]);

	const runMutation = useMutation({
		mutationFn: async (executionMode: RunExecutionMode) => {
			if (!selectedApp) throw new Error("Select an app first");
			if (selectedCaseIds.length === 0) throw new Error("Select at least one test case");

			// No Active Session yet: connect the picked device through the bar's Connect path
			// first. A connect error rejects here, so no Run is created for it.
			let session = activeSession;
			if (!session) {
				if (!device) throw new Error("Pick a device in the top bar first");
				session = await connectDevice(device);
			}

			const client = await getRunnerClient();
			return client.createRun({
				appId: selectedApp.id,
				caseIds: selectedCaseIds,
				deviceId: session.deviceId,
				platform: session.platform,
				executionMode,
			});
		},
		onMutate: () => {
			setExecutionPromptOpen(false);
		},
		onSuccess: (run) => {
			if (selectedApp) {
				void queryClient.invalidateQueries({ queryKey: casesQueryKey(selectedApp.id) });
				void queryClient.invalidateQueries({ queryKey: runsListQueryKey(selectedApp.id) });
			}
			invalidateActiveDeviceSession();
			queryClient.setQueryData(runQueryKey(run.id), run);
			setActiveRun(run.id);
			void navigate({ to: "/runs/$runId", params: { runId: run.id } });
		},
		onError: (error) => {
			showErrorToast(error, "Failed to start run");
		},
	});

	const cancelMutation = useMutation({
		mutationFn: async () => {
			if (!activeRunId) throw new Error("No active run");
			const client = await getRunnerClient();
			return client.cancelRun(activeRunId);
		},
		onSuccess: (run) => {
			queryClient.setQueryData(runQueryKey(run.id), run);
			invalidateActiveDeviceSession();
			if (selectedApp) {
				void queryClient.invalidateQueries({ queryKey: casesQueryKey(selectedApp.id) });
			}
		},
		onError: (error) => {
			showErrorToast(error, "Failed to cancel run");
		},
	});

	const canRun = Boolean(
		selectedApp &&
			target &&
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
					: !target
						? "Pick a device in the top bar to run"
						: `Run ${selectedCaseIds.length} test${selectedCaseIds.length === 1 ? "" : "s"}`;

	const onPrimaryClick = () => {
		if (isRunLive) {
			cancelMutation.mutate();
			return;
		}
		if (selectedCasesWithScript.length > 0) {
			setExecutionPromptOpen(true);
			return;
		}
		// No saved scripts → AI agent by default.
		runMutation.mutate("agent");
	};

	return (
		<>
			<div className="flex shrink-0 items-center gap-3">
				<button
					aria-label={isRunLive ? "Cancel run" : "Run tests"}
					className={[
						"motion-press flex size-12 shrink-0 items-center justify-center rounded-full shadow-float disabled:opacity-40",
						isRunLive ? "bg-error text-on-error" : "bg-primary text-on-primary",
					].join(" ")}
					disabled={isRunLive ? cancelMutation.isPending : !canRun}
					onClick={onPrimaryClick}
					title={runTitle}
					type="button"
				>
					{isRunLive ? (
						<svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
							<rect height="14" rx="1.5" width="4" x="6" y="5" />
							<rect height="14" rx="1.5" width="4" x="14" y="5" />
						</svg>
					) : (
						<svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 24 24">
							<path d="M8 5.5v13l11-6.5L8 5.5Z" />
						</svg>
					)}
				</button>
			</div>

			<AlertDialog>
				<AlertDialog.Backdrop isOpen={executionPromptOpen} onOpenChange={setExecutionPromptOpen}>
					<AlertDialog.Container>
						<AlertDialog.Dialog className="sm:max-w-[420px]">
							<AlertDialog.CloseTrigger />
							<AlertDialog.Header>
								<AlertDialog.Heading>How should we run?</AlertDialog.Heading>
							</AlertDialog.Header>
							<AlertDialog.Body>
								<p>
									{selectedCasesWithScript.length === 1
										? "This test case has a saved script from a previous successful run."
										: `${selectedCasesWithScript.length} selected test cases have saved scripts.`}{" "}
									Use the script for a fast replay without AI, or run with the AI agent instead.
								</p>
							</AlertDialog.Body>
							<AlertDialog.Footer className="flex flex-wrap gap-2">
								<Button
									onPress={() => setExecutionPromptOpen(false)}
									slot="close"
									variant="tertiary"
								>
									Cancel
								</Button>
								<Button
									isDisabled={runMutation.isPending}
									onPress={() => runMutation.mutate("agent")}
									variant="secondary"
								>
									Use AI agent
								</Button>
								<Button
									isDisabled={runMutation.isPending}
									onPress={() => runMutation.mutate("script")}
									variant="primary"
								>
									Use saved scripts
								</Button>
							</AlertDialog.Footer>
						</AlertDialog.Dialog>
					</AlertDialog.Container>
				</AlertDialog.Backdrop>
			</AlertDialog>
		</>
	);
}
