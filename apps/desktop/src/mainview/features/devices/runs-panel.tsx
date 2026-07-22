import { getDesktopRpc } from "@/app/desktop-rpc";
import { Button, Dropdown, Label, ListBox, Select } from "@heroui/react";
import { type SetupPlatformRequest, createRunnerClient } from "@yoqa/runner-client";
import { type SVGProps, useEffect, useRef, useState } from "react";
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

async function setupSelectedDevice(device: SelectedDevice, signal: AbortSignal) {
	const baseUrl = await getDesktopRpc().request.getRunnerBaseUrl();
	const client = createRunnerClient({ baseUrl });

	const request: SetupPlatformRequest = {
		platform: device.platform,
		deviceId: device.id,
		kind: device.kind,
	};

	if (device.platform === "ios" && device.kind === "physical") {
		Object.assign(request, await resolveIosPhysicalSetup());
	}

	return client.setupPlatform(request, { signal });
}

const BUILDS = [
	{ id: "tf-128", label: "TestFlight #128" },
	{ id: "local-1.2.0", label: "1.2.0 (local)" },
	{ id: "ci-8921", label: "CI build #8921" },
	{ id: "store-1.1.4", label: "App Store 1.1.4" },
] as const;

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
	const [device, setDevice] = useState<SelectedDevice | null>(null);
	const [deviceReady, setDeviceReady] = useState(false);
	const [setupDevice, setSetupDevice] = useState<SelectedDevice | null>(null);
	const [setupStatus, setSetupStatus] = useState<DeviceSetupStatus>("loading");
	const [setupMessage, setSetupMessage] = useState<string | null>(null);
	const [setupAttempt, setSetupAttempt] = useState(0);
	const [buildId, setBuildId] = useState<string | null>(null);
	const [deviceOpen, setDeviceOpen] = useState(false);
	const [buildOpen, setBuildOpen] = useState(false);
	const [modalPlatform, setModalPlatform] = useState<DevicePlatform | null>(null);
	const setupAbortRef = useRef<AbortController | null>(null);

	const openPlatformModal = (platform: DevicePlatform) => {
		setDeviceOpen(false);
		setBuildOpen(false);
		setModalPlatform(platform);
	};

	const handleDeviceSelect = (selected: SelectedDevice) => {
		setupAbortRef.current?.abort();
		setDevice(null);
		setDeviceReady(false);
		setSetupStatus("loading");
		setSetupMessage(null);
		setSetupDevice(selected);
		setSetupAttempt((n) => n + 1);
	};

	const cancelSetup = () => {
		setupAbortRef.current?.abort();
		setupAbortRef.current = null;
		setSetupDevice(null);
		setSetupStatus("loading");
		setSetupMessage(null);
		setDeviceReady(false);
	};

	const retrySetup = () => {
		if (!setupDevice) return;
		setSetupStatus("loading");
		setSetupMessage(null);
		setSetupAttempt((n) => n + 1);
	};

	useEffect(() => {
		if (!setupDevice) {
			return;
		}

		void setupAttempt;
		const selected = setupDevice;
		const controller = new AbortController();
		setupAbortRef.current = controller;

		const isIosPhysical = selected.platform === "ios" && selected.kind === "physical";
		setSetupStatus("loading");
		setSetupMessage(
			isIosPhysical
				? "Building and installing WebDriverAgent on your device…"
				: selected.platform === "ios"
					? "Installing Appium XCUITest driver…"
					: "Installing Appium UiAutomator2 driver…",
		);

		void (async () => {
			try {
				await setupSelectedDevice(selected, controller.signal);
				if (controller.signal.aborted) return;
				setDevice(selected);
				setDeviceReady(true);
				setSetupDevice(null);
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
	}, [setupDevice, setupAttempt]);

	const canRun = Boolean(device && deviceReady && buildId);
	const runTitle =
		!device || !deviceReady
			? setupDevice
				? "Waiting for device setup to finish"
				: "Select a device and build to run"
			: !buildId
				? "Select a build to run"
				: "Run tests";

	return (
		<>
			<header className="flex w-full shrink-0 items-center justify-between gap-4 rounded-[var(--radius-platform)] bg-surface-container-lowest/90 px-4 py-3 shadow-soft backdrop-blur-md">
				<div className="blob-actions flex shrink-0 items-center gap-4 px-5 py-3.5 shadow-card">
					<button
						aria-expanded={deviceOpen}
						aria-haspopup="menu"
						aria-label="Select device"
						className="text-white/90 transition-opacity hover:opacity-100"
						onClick={() => {
							setBuildOpen(false);
							setDeviceOpen(true);
						}}
						title="Select device"
						type="button"
					>
						<PhoneIcon className="size-6" />
					</button>
					<button
						aria-expanded={buildOpen}
						aria-haspopup="listbox"
						aria-label="Select build"
						className="text-white/90 transition-opacity hover:opacity-100"
						onClick={() => {
							setDeviceOpen(false);
							setBuildOpen(true);
						}}
						title="Select build"
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
						aria-label="Select build"
						className="w-[11.5rem]"
						isOpen={buildOpen}
						placeholder="Select build"
						selectedKey={buildId}
						onOpenChange={setBuildOpen}
						onSelectionChange={(key) => setBuildId(key == null ? null : String(key))}
					>
						<Select.Trigger className="h-10 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 shadow-none">
							<Select.Value />
							<Select.Indicator className="text-on-surface-variant" />
						</Select.Trigger>
						<Select.Popover>
							<ListBox>
								{BUILDS.map((build) => (
									<ListBox.Item id={build.id} key={build.id} textValue={build.label}>
										{build.label}
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>

					<button
						aria-label="Run tests"
						className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-float transition-transform enabled:hover:scale-105 disabled:opacity-40"
						disabled={!canRun}
						title={runTitle}
						type="button"
					>
						<svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
							<path d="M8 5.5v13l11-6.5L8 5.5Z" />
						</svg>
					</button>
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
		</>
	);
}
