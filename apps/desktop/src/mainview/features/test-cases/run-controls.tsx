import { getDesktopRpc } from "@/app/desktop-rpc";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import type { SelectedDevice } from "@/features/devices/select-device-modal";
import { useActiveDeviceSession } from "@/features/devices/use-active-device-session";
import { runQueryKey, useActiveRun } from "@/features/runs/active-run-context";
import { runsListQueryKey } from "@/features/runs/list-page";
import { type TestCase, casesQueryKey, mapCatalogCase } from "@/features/test-cases/data";
import { useTestCaseSelection } from "@/features/test-cases/selection-context";
import { AlertDialog, Button, ListBox, Select } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type RunExecutionMode,
	type SetupPlatformRequest,
	createRunnerClient,
} from "@yoqa/runner-client";
import { useMemo, useState } from "react";

async function resolveIosPhysicalSetup(): Promise<
	Pick<SetupPlatformRequest, "xcodeDeveloperDir" | "developmentTeam" | "codeSignIdentity">
> {
	const toolchain = await getDesktopRpc().request.getIosToolchain();
	const xcodeDeveloperDir = toolchain.preferences.xcodeDeveloperDir;
	if (!xcodeDeveloperDir) {
		throw new Error("No Xcode selected. Open Settings and choose an Xcode installation.");
	}

	const identity =
		(toolchain.preferences.signingIdentityHash &&
			toolchain.identities.find(
				(item) => item.hash === toolchain.preferences.signingIdentityHash,
			)) ||
		toolchain.identities.find((item) => item.tier === "Paid") ||
		toolchain.identities[0] ||
		null;

	if (!identity) {
		throw new Error(
			"No valid Apple Development certificate found. Open Settings, pick a certificate that is not revoked, and try again.",
		);
	}

	return {
		xcodeDeveloperDir,
		developmentTeam: identity.teamId,
		codeSignIdentity: identity.name,
	};
}

async function setupSelectedDevice(
	device: SelectedDevice,
	signal: AbortSignal,
	options?: { force?: boolean },
) {
	const baseUrl = await getDesktopRpc().request.getRunnerBaseUrl();
	const client = createRunnerClient({ baseUrl });

	const request: SetupPlatformRequest = {
		platform: device.platform,
		deviceId: device.id,
		kind: device.kind,
		force: options?.force === true ? true : undefined,
	};

	if (device.platform === "ios" && device.kind === "physical") {
		Object.assign(request, await resolveIosPhysicalSetup());
	}

	return client.setupPlatform(request, { signal });
}

/** WebDriverAgent policy for iOS physical runs (`force` maps to setup `--force`). */
const WDA_MODES = [
	{ id: "skip", label: "Skip" },
	{ id: "rebuild", label: "Rebuild" },
] as const;

type WdaMode = (typeof WDA_MODES)[number]["id"];

/**
 * Starts (or cancels) a run of the selected test cases on the device that is
 * connected in the top session bar.
 */
export function RunControls() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { selectedCaseIds } = useTestCaseSelection();
	const { activeRunId, isRunLive, setActiveRun } = useActiveRun();
	const { activeSession, invalidateActiveDeviceSession } = useActiveDeviceSession();
	const [wdaMode, setWdaMode] = useState<WdaMode>("skip");
	const [executionPromptOpen, setExecutionPromptOpen] = useState(false);

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
			if (!activeSession) throw new Error("Connect a device in the top bar first");
			if (selectedCaseIds.length === 0) throw new Error("Select at least one test case");

			// Rebuild → force WebDriverAgent rebuild/install on iOS (setup `--force`).
			if (wdaMode === "rebuild" && activeSession.platform === "ios") {
				const device: SelectedDevice = {
					id: activeSession.deviceId,
					platform: "ios",
					label: activeSession.deviceId,
					name: activeSession.deviceId,
					osVersion: "",
					kind: "physical",
				};
				await setupSelectedDevice(device, new AbortController().signal, { force: true });
			}

			const client = await getRunnerClient();
			return client.createRun({
				appId: selectedApp.id,
				caseIds: selectedCaseIds,
				deviceId: activeSession.deviceId,
				platform: activeSession.platform,
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
			activeSession &&
			!activeSession.heldByRun &&
			selectedCaseIds.length > 0 &&
			!runMutation.isPending &&
			!isRunLive,
	);
	const runTitle = isRunLive
		? "Cancel run"
		: runMutation.isPending
			? "Starting run…"
			: !selectedApp
				? "Select an app to run"
				: selectedCaseIds.length === 0
					? "Select test cases to run"
					: !activeSession
						? "Connect a device in the top bar to run"
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
				<Select
					aria-label="WebDriverAgent mode"
					className="w-[11.5rem]"
					placeholder="WDA"
					selectedKey={wdaMode}
					onSelectionChange={(key) => {
						if (key === "skip" || key === "rebuild") setWdaMode(key);
					}}
				>
					<Select.Trigger className="h-10 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 shadow-none">
						<Select.Value />
						<Select.Indicator className="text-on-surface-variant" />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{WDA_MODES.map((mode) => (
								<ListBox.Item id={mode.id} key={mode.id} textValue={mode.label}>
									{mode.label}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>

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
