import {
	type DevicePlatform,
	SelectDeviceModal,
	type SelectedDevice,
} from "@/features/devices/select-device-modal";
import { Button, ListBox, Select } from "@heroui/react";
import type { ActiveDeviceResponse } from "@yoqa/runner-client";
import { type SVGProps, useState } from "react";

const PLATFORMS = [
	{ id: "ios" as const, label: "iOS" },
	{ id: "android" as const, label: "Android" },
];

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

type SessionToolbarProps = {
	platform: DevicePlatform;
	onPlatformChange: (platform: DevicePlatform) => void;
	device: SelectedDevice | null;
	onDeviceSelect: (device: SelectedDevice) => void;
	active: ActiveDeviceResponse | null;
	connecting: boolean;
	refreshing: boolean;
	onConnect: () => void;
	onDisconnect: () => void;
	onRefresh: () => void;
	runLiveWarning: boolean;
};

export function SessionToolbar({
	platform,
	onPlatformChange,
	device,
	onDeviceSelect,
	active,
	connecting,
	refreshing,
	onConnect,
	onDisconnect,
	onRefresh,
	runLiveWarning,
}: SessionToolbarProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const connected = active != null;

	return (
		<div className="flex flex-col gap-2 border-b border-outline-variant/40 px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<Select
					aria-label="Platform"
					className="w-32"
					selectedKey={platform}
					onSelectionChange={(key) => {
						if (key === "ios" || key === "android") onPlatformChange(key);
					}}
				>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{PLATFORMS.map((item) => (
								<ListBox.Item key={item.id} id={item.id} textValue={item.label}>
									{item.label}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>

				<Button
					className="min-w-40 justify-start"
					isDisabled={connecting}
					variant="secondary"
					onPress={() => setPickerOpen(true)}
				>
					<PhoneIcon />
					<span className="truncate">{device?.label ?? "Select device"}</span>
				</Button>

				{connected ? (
					<Button
						isDisabled={connecting}
						variant="danger"
						onPress={() => {
							onDisconnect();
						}}
					>
						Disconnect
					</Button>
				) : (
					<Button
						isDisabled={!device || connecting}
						variant="primary"
						onPress={() => {
							onConnect();
						}}
					>
						{connecting ? "Connecting…" : "Connect"}
					</Button>
				)}

				<Button
					isDisabled={!connected || refreshing || connecting}
					variant="secondary"
					onPress={() => {
						onRefresh();
					}}
				>
					{refreshing ? "Refreshing…" : "Refresh"}
				</Button>

				{connected ? (
					<span className="text-helper text-on-surface-variant">
						Connected · {active.platform} · {active.deviceId.slice(0, 8)}…
					</span>
				) : null}
			</div>

			{runLiveWarning ? (
				<p className="text-helper text-on-surface-variant">
					A catalog run is live (separate Appium session). Connect here for interactive inspect — it
					won’t share that run’s session.
				</p>
			) : null}

			<SelectDeviceModal
				open={pickerOpen}
				platform={platform}
				onClose={() => setPickerOpen(false)}
				onSelect={(selected) => {
					onDeviceSelect(selected);
					setPickerOpen(false);
				}}
			/>
		</div>
	);
}
