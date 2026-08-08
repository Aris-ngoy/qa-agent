import { getDesktopRpc } from "@/app/desktop-rpc";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { useApps } from "@/features/apps/context";
import { runQueryKey, useActiveRun } from "@/features/runs/active-run-context";
import { runsListQueryKey } from "@/features/runs/list-page";
import { type TestCase, casesQueryKey, mapCatalogCase } from "@/features/test-cases/data";
import { useTestCaseSelection } from "@/features/test-cases/selection-context";
import { AlertDialog, Button, Dropdown, Label, ListBox, Select } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	type RunExecutionMode,
	type SetupPlatformRequest,
	createRunnerClient,
} from "@yoqa/runner-client";
import { type SVGProps, useEffect, useMemo, useRef, useState } from "react";
import { DeviceSetupPanel, type DeviceSetupStatus } from "./device-setup-panel";
import { type DevicePlatform, SelectDeviceModal, type SelectedDevice } from "./select-device-modal";

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

const PLATFORMS = [
	{ id: "ios", label: "iOS", available: true },
	{ id: "android", label: "Android", available: true },
	{ id: "web", label: "Web", available: false },
	{ id: "desktop", label: "Desktop", available: false },
] as const;

function PhoneIcon({ className = "size-4", ...props }: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className={`block shrink-0 ${className}`}
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<rect height="16" rx="2" width="10" x="7" y="4" />
			<path d="M11 17h2" strokeLinecap="round" />
		</svg>
	);
}

function AppleIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0"
			fill="currentColor"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.22-1.98 1.08-3.13-1.05.04-2.31.7-3.06 1.58-.67.78-1.25 2.05-1.09 3.25 1.15.09 2.33-.59 3.07-1.7" />
		</svg>
	);
}

function AndroidIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0"
			fill="currentColor"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85-.29-.15-.65-.06-.83.22l-1.88 3.24a11.43 11.43 0 00-8.94 0L5.65 5.67c-.19-.28-.54-.37-.83-.22-.3.16-.42.54-.26.85l1.84 3.18C2.86 11.21 1.3 14.5 1.25 18.18h21.5c-.06-3.68-1.62-6.97-5.15-8.7M7 15.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5m10 0a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5" />
		</svg>
	);
}

function GlobeIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<circle cx="12" cy="12" r="9" />
			<path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" strokeLinecap="round" />
		</svg>
	);
}

function LaptopIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<rect height="10" rx="1.5" width="14" x="5" y="5" />
			<path d="M3 17h18M8 17l-.5 2h9l-.5-2" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function KeyIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path
				d="M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L4 17v3h3l4.3-4.3a4.5 4.5 0 0 0 6.4-6.4Z"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function DownloadIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M12 3v12M8 11l4 4 4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

const PLATFORM_ICONS = {
	ios: AppleIcon,
	android: AndroidIcon,
	web: GlobeIcon,
	desktop: LaptopIcon,
} as const;

export function RunsPanel() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { selectedCaseIds } = useTestCaseSelection();
	const { activeRunId, isRunLive, setActiveRun, run: activeRun } = useActiveRun();
	const [device, setDevice] = useState<SelectedDevice | null>(null);
	const [deviceReady, setDeviceReady] = useState(false);
	const [setupDevice, setSetupDevice] = useState<SelectedDevice | null>(null);
	const [setupStatus, setSetupStatus] = useState<DeviceSetupStatus>("loading");
	const [setupMessage, setSetupMessage] = useState<string | null>(null);
	const [setupAttempt, setSetupAttempt] = useState(0);
	const [setupForce, setSetupForce] = useState(false);
	const [wdaMode, setWdaMode] = useState<WdaMode>("skip");
	const [deviceOpen, setDeviceOpen] = useState(false);
	const [wdaOpen, setWdaOpen] = useState(false);
	const [modalPlatform, setModalPlatform] = useState<DevicePlatform | null>(null);
	const [executionPromptOpen, setExecutionPromptOpen] = useState(false);
	const setupAbortRef = useRef<AbortController | null>(null);

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
			if (!selectedApp) {
				throw new Error("Select an app first");
			}
			if (!device || !deviceReady) {
				throw new Error("Select a ready device");
			}
			if (selectedCaseIds.length === 0) {
				throw new Error("Select at least one test case");
			}

			// Rebuild → force WebDriverAgent rebuild/install on physical iOS (setup `--force`).
			if (wdaMode === "rebuild" && device.platform === "ios" && device.kind === "physical") {
				await setupSelectedDevice(device, new AbortController().signal, { force: true });
			}

			const client = await getRunnerClient();
			return client.createRun({
				appId: selectedApp.id,
				caseIds: selectedCaseIds,
				deviceId: device.id,
				platform: device.platform,
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
			if (!activeRunId) {
				throw new Error("No active run");
			}
			const client = await getRunnerClient();
			return client.cancelRun(activeRunId);
		},
		onSuccess: (run) => {
			queryClient.setQueryData(runQueryKey(run.id), run);
			if (selectedApp) {
				void queryClient.invalidateQueries({ queryKey: casesQueryKey(selectedApp.id) });
			}
		},
		onError: (error) => {
			showErrorToast(error, "Failed to cancel run");
		},
	});

	const openPlatformModal = (platform: DevicePlatform) => {
		setDeviceOpen(false);
		setWdaOpen(false);
		setModalPlatform(platform);
	};

	const handleDeviceSelect = (selected: SelectedDevice) => {
		setupAbortRef.current?.abort();
		setDevice(null);
		setDeviceReady(false);
		setSetupStatus("loading");
		setSetupMessage(null);
		setSetupForce(false);
		setSetupDevice(selected);
		setSetupAttempt((n) => n + 1);
	};

	const cancelSetup = () => {
		setupAbortRef.current?.abort();
		setupAbortRef.current = null;
		setSetupDevice(null);
		setSetupForce(false);
		setSetupStatus("loading");
		setSetupMessage(null);
		setDeviceReady(false);
	};

	const retrySetup = () => {
		if (!setupDevice) return;
		setSetupStatus("loading");
		setSetupMessage(null);
		setSetupForce(true);
		setSetupAttempt((n) => n + 1);
	};

	useEffect(() => {
		if (!setupDevice) {
			return;
		}

		void setupAttempt;
		const selected = setupDevice;
		const forceRebuild = setupForce;
		const controller = new AbortController();
		setupAbortRef.current = controller;

		const isIosPhysical = selected.platform === "ios" && selected.kind === "physical";
		setSetupStatus("loading");
		setSetupMessage(
			isIosPhysical
				? "Preparing iOS device…"
				: selected.platform === "ios"
					? "Installing Appium XCUITest driver…"
					: "Installing Appium UiAutomator2 driver…",
		);

		void (async () => {
			try {
				await setupSelectedDevice(selected, controller.signal, { force: forceRebuild });
				if (controller.signal.aborted) return;
				setDevice(selected);
				setDeviceReady(true);
				setSetupDevice(null);
				setSetupForce(false);
				setSetupStatus("loading");
				setSetupMessage(null);
			} catch (error) {
				if (controller.signal.aborted) return;
				const message =
					error instanceof Error
						? error.message
						: "Failed to set up the test runner on this device.";
				setSetupStatus("error");
				setSetupMessage(message);
			} finally {
				if (setupAbortRef.current === controller) {
					setupAbortRef.current = null;
				}
			}
		})();

		return () => {
			controller.abort();
		};
	}, [setupDevice, setupAttempt, setupForce]);

	// After a run finishes, refresh cases so newly saved scripts show up.
	useEffect(() => {
		if (!activeRun || activeRun.status === "queued" || activeRun.status === "running") {
			return;
		}
		void queryClient.invalidateQueries({ queryKey: casesQueryKey(activeRun.appId) });
		void queryClient.invalidateQueries({ queryKey: runsListQueryKey(activeRun.appId) });
	}, [activeRun, queryClient]);

	const canRun = Boolean(
		selectedApp &&
			device &&
			deviceReady &&
			wdaMode &&
			selectedCaseIds.length > 0 &&
			!runMutation.isPending &&
			!isRunLive,
	);
	const runTitle = isRunLive
		? "Cancel run"
		: runMutation.isPending
			? wdaMode === "rebuild" && device?.platform === "ios" && device.kind === "physical"
				? "Rebuilding WebDriverAgent…"
				: "Starting run…"
			: !selectedApp
				? "Select an app to run"
				: selectedCaseIds.length === 0
					? "Select test cases to run"
					: !device || !deviceReady
						? setupDevice
							? "Waiting for device setup to finish"
							: "Select a device to run"
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
			<header className="flex w-full shrink-0 flex-col gap-2 rounded-[var(--radius-platform)] bg-surface-container-lowest/90 px-4 py-3 shadow-soft backdrop-blur-md">
				<div className="flex w-full items-center justify-between gap-4">
					<div className="blob-actions flex shrink-0 items-center gap-4 px-5 py-3.5 shadow-card">
						<button
							aria-expanded={deviceOpen}
							aria-haspopup="menu"
							aria-label="Select device"
							className="text-white/90 transition-opacity hover:opacity-100"
							onClick={() => {
								setWdaOpen(false);
								setDeviceOpen(true);
							}}
							title="Select device"
							type="button"
						>
							<PhoneIcon className="size-6" />
						</button>
						<button
							aria-expanded={wdaOpen}
							aria-haspopup="listbox"
							aria-label="WebDriverAgent mode"
							className="text-white/90 transition-opacity hover:opacity-100"
							onClick={() => {
								setDeviceOpen(false);
								setWdaOpen(true);
							}}
							title="WebDriverAgent: Skip or Rebuild"
							type="button"
						>
							<KeyIcon />
						</button>
						<button
							aria-label="Export results"
							className="text-white/90 transition-opacity hover:opacity-100"
							title="Export results"
							type="button"
						>
							<DownloadIcon />
						</button>
					</div>

					<div className="flex min-w-0 shrink-0 items-center gap-3">
						<Dropdown isOpen={deviceOpen} onOpenChange={setDeviceOpen}>
							<Button
								aria-label="Select device"
								className="h-10 w-[13.5rem] justify-start gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 text-body-md shadow-none data-[hovered=true]:bg-surface-container-low"
								variant="outline"
							>
								<span className="inline-flex shrink-0 items-center text-on-surface-variant">
									<PhoneIcon />
								</span>
								<span
									className={`min-w-0 flex-1 truncate text-left ${device || setupDevice ? "text-on-surface" : "text-on-surface-variant"}`}
								>
									{setupDevice?.label ?? device?.label ?? "Select device"}
								</span>
								<span className="text-on-surface-variant">
									<ChevronDownIcon />
								</span>
							</Button>
							<Dropdown.Popover className="w-[13.5rem]">
								<Dropdown.Menu
									onAction={(key) => {
										const id = String(key);
										if (id === "ios" || id === "android") {
											openPlatformModal(id);
										}
									}}
								>
									{PLATFORMS.map((platform) => {
										const Icon = PLATFORM_ICONS[platform.id];
										return (
											<Dropdown.Item
												id={platform.id}
												isDisabled={!platform.available}
												key={platform.id}
												textValue={platform.label}
											>
												<Icon />
												<Label className="flex-1">{platform.label}</Label>
												{platform.available ? null : (
													<span className="text-helper text-on-surface-variant">soon</span>
												)}
											</Dropdown.Item>
										);
									})}
								</Dropdown.Menu>
							</Dropdown.Popover>
						</Dropdown>

						<Select
							aria-label="WebDriverAgent mode"
							className="w-[11.5rem]"
							isOpen={wdaOpen}
							placeholder="WDA"
							selectedKey={wdaMode}
							onOpenChange={setWdaOpen}
							onSelectionChange={(key) => {
								if (key === "skip" || key === "rebuild") {
									setWdaMode(key);
								}
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
								"motion-press flex size-14 shrink-0 items-center justify-center rounded-full shadow-float disabled:opacity-40",
								isRunLive ? "bg-error text-on-error" : "bg-primary text-on-primary",
							].join(" ")}
							disabled={isRunLive ? cancelMutation.isPending : !canRun}
							onClick={onPrimaryClick}
							title={runTitle}
							type="button"
						>
							{isRunLive ? (
								<svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
									<rect height="14" rx="1.5" width="4" x="6" y="5" />
									<rect height="14" rx="1.5" width="4" x="14" y="5" />
								</svg>
							) : (
								<svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
									<path d="M8 5.5v13l11-6.5L8 5.5Z" />
								</svg>
							)}
						</button>
					</div>
				</div>
			</header>

			<SelectDeviceModal
				onClose={() => setModalPlatform(null)}
				onSelect={handleDeviceSelect}
				open={modalPlatform !== null}
				platform={modalPlatform ?? "ios"}
			/>

			{setupDevice ? (
				<DeviceSetupPanel
					device={setupDevice}
					message={setupMessage}
					onCancel={cancelSetup}
					onRetry={retrySetup}
					open
					status={setupStatus}
				/>
			) : null}

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
