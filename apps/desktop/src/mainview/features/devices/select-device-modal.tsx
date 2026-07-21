import { Modal, Tabs } from "@heroui/react";
import { type SVGProps, useEffect, useState } from "react";

export type DevicePlatform = "ios" | "android";

export type SelectedDevice = {
	id: string;
	label: string;
	name: string;
	osVersion: string;
	platform: DevicePlatform;
};

type DeviceTab = "local" | "simulators";

type DeviceRow = {
	id: string;
	name: string;
	owner?: string;
	osVersion: string;
};

type SelectDeviceModalProps = {
	open: boolean;
	platform: DevicePlatform;
	onClose: () => void;
	onSelect: (device: SelectedDevice) => void;
};

const IOS_LOCAL_DEVICES: DeviceRow[] = [
	{
		id: "ios-local-iphone-17-pro",
		name: "iPhone 17 Pro",
		owner: "Aristote's iPhone",
		osVersion: "iOS 26.5.1",
	},
];

const IOS_SIMULATORS: DeviceRow[] = [
	{ id: "ios-sim-iphone-17-pro", name: "iPhone 17 Pro", osVersion: "iOS 26.0" },
	{ id: "ios-sim-iphone-17", name: "iPhone 17", osVersion: "iOS 26.0" },
	{ id: "ios-sim-iphone-16-pro", name: "iPhone 16 Pro", osVersion: "iOS 18.5" },
	{ id: "ios-sim-iphone-16", name: "iPhone 16", osVersion: "iOS 18.5" },
	{ id: "ios-sim-iphone-15-pro", name: "iPhone 15 Pro", osVersion: "iOS 18.4" },
	{ id: "ios-sim-iphone-15", name: "iPhone 15", osVersion: "iOS 18.4" },
	{ id: "ios-sim-iphone-se", name: "iPhone SE (3rd generation)", osVersion: "iOS 18.4" },
	{ id: "ios-sim-ipad-pro-13", name: "iPad Pro 13-inch (M4)", osVersion: "iOS 18.5" },
	{ id: "ios-sim-ipad-pro-11", name: "iPad Pro 11-inch (M4)", osVersion: "iOS 18.5" },
	{ id: "ios-sim-ipad-air", name: "iPad Air 13-inch (M2)", osVersion: "iOS 18.4" },
	{ id: "ios-sim-ipad-mini", name: "iPad mini (A17 Pro)", osVersion: "iOS 18.4" },
	{ id: "ios-sim-ipad-10", name: "iPad (10th generation)", osVersion: "iOS 18.4" },
	{ id: "ios-sim-iphone-14-pro", name: "iPhone 14 Pro", osVersion: "iOS 17.5" },
	{ id: "ios-sim-iphone-13", name: "iPhone 13", osVersion: "iOS 17.5" },
];

const ANDROID_LOCAL_DEVICES: DeviceRow[] = [
	{
		id: "android-local-pixel-9",
		name: "Pixel 9 Pro",
		owner: "Aristote's Pixel",
		osVersion: "Android 15",
	},
];

const ANDROID_SIMULATORS: DeviceRow[] = [
	{ id: "android-emu-pixel-9", name: "Pixel 9", osVersion: "Android 15" },
	{ id: "android-emu-pixel-8", name: "Pixel 8", osVersion: "Android 14" },
	{ id: "android-emu-pixel-7", name: "Pixel 7", osVersion: "Android 14" },
	{ id: "android-emu-tablet", name: "Pixel Tablet", osVersion: "Android 14" },
];

const PLATFORM_COPY: Record<
	DevicePlatform,
	{
		title: string;
		local: DeviceRow[];
		simulators: DeviceRow[];
		simulatorLabel: string;
		localChecklist: string[];
	}
> = {
	ios: {
		title: "Select Device — iOS",
		local: IOS_LOCAL_DEVICES,
		simulators: IOS_SIMULATORS,
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
		local: ANDROID_LOCAL_DEVICES,
		simulators: ANDROID_SIMULATORS,
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

function DeviceList({
	devices,
	onSelect,
}: {
	devices: DeviceRow[];
	onSelect: (device: DeviceRow) => void;
}) {
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
						<span className="shrink-0 text-body-sm text-on-surface-variant">
							{device.osVersion}
						</span>
					</button>
				</li>
			))}
		</ul>
	);
}

export function SelectDeviceModal({ open, platform, onClose, onSelect }: SelectDeviceModalProps) {
	const [tab, setTab] = useState<DeviceTab>("local");
	const copy = PLATFORM_COPY[platform];

	useEffect(() => {
		if (open) {
			setTab("local");
		}
	}, [open]);

	const handleSelect = (device: DeviceRow) => {
		onSelect({
			id: device.id,
			label: deviceLabel(device),
			name: device.name,
			osVersion: device.osVersion,
			platform,
		});
		onClose();
	};

	const tabs: { id: DeviceTab; label: string; count: number; icon: typeof PhoneIcon }[] = [
		{ id: "local", label: "Local Devices", count: copy.local.length, icon: PhoneIcon },
		{
			id: "simulators",
			label: copy.simulatorLabel,
			count: copy.simulators.length,
			icon: MonitorIcon,
		},
	];

	return (
		<Modal>
			<Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onClose()} variant="opaque">
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="max-h-[min(40rem,90vh)] sm:max-w-2xl">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading className="text-headline-md text-on-surface">
								{copy.title}
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="gap-5 px-6 pb-6 pt-1">
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
									<DeviceList devices={copy.local} onSelect={handleSelect} />
								</Tabs.Panel>

								<Tabs.Panel className="pt-5" id="simulators">
									<DeviceList devices={copy.simulators} onSelect={handleSelect} />
								</Tabs.Panel>
							</Tabs>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
