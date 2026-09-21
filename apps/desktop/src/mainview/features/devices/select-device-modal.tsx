import { getDesktopRpc } from "@/app/desktop-rpc";
import { Button, Modal, ProgressCircle, Tabs } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { type Device, createRunnerClient } from "@yoqa/runner-client";
import { type SVGProps, useEffect, useMemo, useRef, useState } from "react";

export type DevicePlatform = "ios" | "android";

export type SelectedDevice = {
	id: string;
	label: string;
	name: string;
	osVersion: string;
	platform: DevicePlatform;
	kind: "physical" | "simulator" | "emulator";
};

type DeviceTab = "local" | "simulators";

type DeviceRow = {
	id: string;
	name: string;
	owner?: string;
	osVersion: string;
	state?: string;
	kind: "physical" | "simulator" | "emulator";
};

type SelectDeviceModalProps = {
	open: boolean;
	platform: DevicePlatform;
	onClose: () => void;
	onSelect: (device: SelectedDevice) => void;
};

const PLATFORM_COPY: Record<
	DevicePlatform,
	{
		title: string;
		simulatorLabel: string;
		localChecklist: string[];
	}
> = {
	ios: {
		title: "Select Device — iOS",
		simulatorLabel: "Local Simulators",
		localChecklist: [
			"Device is connected via cable",
			"Device is unlocked",
			'Device trusts this computer (tap "Trust" if prompted)',
			"Developer Mode is enabled in Settings → Privacy & Security",
			"Device is connected to the internet",
		],
	},
	android: {
		title: "Select Device — Android",
		simulatorLabel: "Local Emulators",
		localChecklist: [
			"Device is connected via cable",
			"USB debugging is enabled",
			"Device is unlocked",
			"This computer is authorized for debugging",
			"Device is connected to the internet",
		],
	},
};

function PhoneIcon(props: SVGProps<SVGSVGElement>) {
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
			<rect height="16" rx="2" width="10" x="7" y="4" />
			<path d="M11 17h2" strokeLinecap="round" />
		</svg>
	);
}

function MonitorIcon(props: SVGProps<SVGSVGElement>) {
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
			<rect height="12" rx="1.5" width="18" x="3" y="4" />
			<path d="M8 20h8M12 16v4" strokeLinecap="round" />
		</svg>
	);
}

function deviceLabel(device: DeviceRow): string {
	return device.owner ? `${device.name} (${device.owner})` : device.name;
}

function toDeviceRow(device: Device): DeviceRow {
	return {
		id: device.id,
		name: device.name,
		owner: device.owner,
		osVersion: device.osVersion,
		state: device.state,
		kind: device.kind,
	};
}

function DeviceList({
	devices,
	loading,
	error,
	onSelect,
}: {
	devices: DeviceRow[];
	loading: boolean;
	error: string | null;
	onSelect: (device: DeviceRow) => void;
}) {
	if (loading) {
		return (
			<p className="px-1 py-6 text-center text-body-md text-on-surface-variant">
				Scanning for devices…
			</p>
		);
	}

	if (error) {
		return <p className="px-1 py-6 text-center text-body-md text-danger">{error}</p>;
	}

	if (devices.length === 0) {
		return (
			<p className="px-1 py-6 text-center text-body-md text-on-surface-variant">
				No devices found.
			</p>
		);
	}

	return (
		<ul className="divide-y divide-outline-variant/60">
			{devices.map((device) => (
				<li key={device.id}>
					<button
						className="flex w-full items-center justify-between gap-4 px-1 py-3.5 text-left transition-colors hover:bg-surface-container-low"
						onClick={() => onSelect(device)}
						type="button"
					>
						<span className="min-w-0 text-body-md font-semibold text-on-surface">
							{device.name}
							{device.owner ? (
								<span className="font-normal text-on-surface-variant"> ({device.owner})</span>
							) : null}
						</span>
						<span className="shrink-0 text-right text-body-sm text-on-surface-variant">
							<span className="block">{device.osVersion}</span>
							{device.state ? (
								<span className="block text-helper capitalize text-on-surface-variant/80">
									{device.state}
								</span>
							) : null}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

async function fetchPlatformDevices(platform: DevicePlatform): Promise<Device[]> {
	const baseUrl = await getDesktopRpc().request.getRunnerBaseUrl();
	const client = createRunnerClient({ baseUrl });
	const response = await client.listDevices(platform, { includeUnavailable: true });
	return response.devices;
}

export function SelectDeviceModal({ open, platform, onClose, onSelect }: SelectDeviceModalProps) {
	const [tab, setTab] = useState<DeviceTab>("local");
	const copy = PLATFORM_COPY[platform];
	/** Check-and-install runs inside this dialog: picked device → installing → done. */
	const [installView, setInstallView] = useState<{
		device: DeviceRow;
		phase: "installing" | "error";
		message: string | null;
	} | null>(null);
	const installAbortRef = useRef<AbortController | null>(null);

	const devicesQuery = useQuery({
		queryKey: ["devices", platform],
		queryFn: () => fetchPlatformDevices(platform),
		enabled: open,
		refetchOnWindowFocus: true,
		refetchOnMount: "always",
		staleTime: 5_000,
	});

	useEffect(() => {
		if (open) {
			setTab("local");
			installAbortRef.current?.abort();
			installAbortRef.current = null;
			setInstallView(null);
		}
	}, [open]);

	useEffect(() => {
		return () => {
			installAbortRef.current?.abort();
		};
	}, []);

	const { local, virtual } = useMemo(() => {
		const devices = devicesQuery.data ?? [];
		return {
			local: devices.filter((device) => device.kind === "physical").map(toDeviceRow),
			virtual: devices
				.filter((device) => device.kind === "simulator" || device.kind === "emulator")
				.map(toDeviceRow),
		};
	}, [devicesQuery.data]);

	const finishSelect = (device: DeviceRow) => {
		installAbortRef.current?.abort();
		installAbortRef.current = null;
		setInstallView(null);
		onSelect({
			id: device.id,
			label: deviceLabel(device),
			name: device.name,
			osVersion: device.osVersion,
			platform,
			kind: device.kind,
		});
		onClose();
	};

	const runModalInstall = async (device: DeviceRow) => {
		// Argent builds and signs its runner automatically on connect — no
		// separate install step. Proceed to select and let connect do it.
		finishSelect(device);
	};

	const cancelInstallView = () => {
		installAbortRef.current?.abort();
		installAbortRef.current = null;
		setInstallView(null);
	};

	const handleSelect = (device: DeviceRow) => {
		// Argent builds its runner on connect — select immediately and let
		// connect be the ground truth (trust prompt handled there).
		finishSelect(device);
	};

	const loading = devicesQuery.isLoading || devicesQuery.isFetching;
	const error =
		devicesQuery.error instanceof Error
			? `${devicesQuery.error.message}. Is the runner running?`
			: devicesQuery.error
				? "Failed to load devices. Is the runner running?"
				: null;

	const tabs: { id: DeviceTab; label: string; count: number; icon: typeof PhoneIcon }[] = [
		{ id: "local", label: "Local Devices", count: local.length, icon: PhoneIcon },
		{
			id: "simulators",
			label: copy.simulatorLabel,
			count: virtual.length,
			icon: MonitorIcon,
		},
	];

	const handleClose = () => {
		cancelInstallView();
		onClose();
	};

	const installing = installView?.phase === "installing";
	const installFailed = installView?.phase === "error";

	return (
		<Modal>
			<Modal.Backdrop
				isOpen={open}
				onOpenChange={(next) => !next && handleClose()}
				variant="opaque"
			>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="max-h-[min(40rem,90vh)] sm:max-w-2xl">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading className="text-headline-md text-on-surface">
								{installView ? `Set up ArgentRunner on ${installView.device.name}` : copy.title}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="gap-5 px-6 pb-6 pt-1">
							{installView ? (
								<div className="flex flex-col items-center gap-4 py-8 text-center">
									{installing ? (
										<ProgressCircle
											aria-label="Setting up ArgentRunner"
											className="text-on-surface-variant"
											color="default"
											isIndeterminate
											size="lg"
										>
											<ProgressCircle.Track>
												<ProgressCircle.TrackCircle className="stroke-outline-variant" />
												<ProgressCircle.FillCircle className="stroke-on-surface-variant" />
											</ProgressCircle.Track>
										</ProgressCircle>
									) : null}
									<div className="flex max-w-md flex-col items-center gap-1.5">
										<p className="text-body-md font-medium text-on-surface">
											{installFailed
												? "Couldn’t set up ArgentRunner"
												: "Setting up ArgentRunner on your device..."}
										</p>
										<p
											className={`text-body-sm ${installFailed ? "text-danger" : "text-on-surface-variant"}`}
										>
											{installFailed
												? (installView.message ??
													"Something went wrong while installing the test runner.")
												: "Building and signing the runner — first install takes 1–2 minutes."}
										</p>
										{installFailed ? null : (
											<p className="mt-1 text-helper text-on-surface-variant">
												Requires a signing identity in Settings → iOS.
											</p>
										)}
									</div>
									<div className="mt-2 flex items-center gap-3">
										{installFailed ? (
											<>
												<Button
													onPress={() => {
														if (installView) void runModalInstall(installView.device);
													}}
													variant="primary"
												>
													Retry install
												</Button>
												<Button onPress={cancelInstallView} variant="secondary">
													Back to devices
												</Button>
											</>
										) : (
											<Button onPress={cancelInstallView} variant="secondary">
												Cancel
											</Button>
										)}
									</div>
								</div>
							) : (
								<Tabs
									className="w-full"
									onSelectionChange={(key) => setTab(String(key) as DeviceTab)}
									selectedKey={tab}
								>
									<Tabs.ListContainer>
										<Tabs.List
											aria-label="Device source"
											className="w-full gap-1 rounded-xl bg-surface-container p-1 *:flex-1 *:justify-center"
										>
											{tabs.map((item) => {
												const Icon = item.icon;
												return (
													<Tabs.Tab
														className="h-auto min-h-10 gap-2 rounded-lg px-3 py-2 text-body-sm font-medium text-on-surface-variant data-[selected=true]:bg-surface-container-lowest data-[selected=true]:text-on-surface data-[selected=true]:shadow-card"
														id={item.id}
														key={item.id}
													>
														<Icon />
														<span className="truncate">{item.label}</span>
														<span className="rounded-full bg-surface-container-high px-2 py-0.5 text-helper font-semibold text-on-surface-variant">
															{item.count}
														</span>
														<Tabs.Indicator className="hidden" />
													</Tabs.Tab>
												);
											})}
										</Tabs.List>
									</Tabs.ListContainer>

									<Tabs.Panel className="pt-5" id="local">
										<div className="mb-4 rounded-xl border border-outline-variant bg-surface-container-low/60 px-4 py-3.5">
											<p className="mb-2 text-body-md font-semibold text-on-surface">
												Before selecting a device, make sure:
											</p>
											<ul className="list-disc space-y-1 pl-5 text-body-sm text-on-surface">
												{copy.localChecklist.map((item) => (
													<li key={item}>{item}</li>
												))}
											</ul>
											<p className="mt-3 text-body-sm text-on-surface-variant">
												First-time setup takes 1–2 minutes
											</p>
										</div>
										<DeviceList
											devices={local}
											error={error}
											loading={loading}
											onSelect={handleSelect}
										/>
									</Tabs.Panel>

									<Tabs.Panel className="pt-5" id="simulators">
										<DeviceList
											devices={virtual}
											error={error}
											loading={loading}
											onSelect={handleSelect}
										/>
									</Tabs.Panel>
								</Tabs>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
