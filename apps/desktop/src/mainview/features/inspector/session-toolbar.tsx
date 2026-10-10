import {
	type DevicePlatform,
	SelectDeviceModal,
	type SelectedDevice,
} from "@/features/devices/select-device-modal";
import { ServersDoctorPanel } from "@/features/devices/servers-doctor-panel";
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
	live: boolean;
	onConnect: () => void;
	onRestart: () => void;
	onDisconnect: () => void;
	/** A Run owns the shared session — watch-only until it finishes. */
	viewOnly: boolean;
};

export function SessionToolbar({
	platform,
	onPlatformChange,
	device,
	onDeviceSelect,
	active,
	connecting,
	live,
	onConnect,
	onRestart,
	onDisconnect,
	viewOnly,
}: SessionToolbarProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [serversOpen, setServersOpen] = useState(false);
	const connected = active != null;
	const canRestart = connected || device != null;

	return (
		<div className="flex flex-col items-end gap-1">
			<div className="flex flex-wrap items-center justify-end gap-2">
				<Select
					aria-label="Platform"
					className="w-28"
					isDisabled={connected || connecting}
					selectedKey={platform}
					onSelectionChange={(key) => {
						if (key === "ios" || key === "android") onPlatformChange(key);
					}}
				>
					<Select.Trigger className="h-9">
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
					className={[
						"min-w-44 max-w-56 justify-start",
						device ? "font-mono text-body-sm" : "",
					].join(" ")}
					isDisabled={connecting || connected}
					size="sm"
					variant="secondary"
					onPress={() => setPickerOpen(true)}
				>
					<PhoneIcon />
					<span className="truncate">{device?.label ?? "Select device"}</span>
				</Button>

				{connected ? (
					<>
						<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-2.5 py-1 text-body-sm font-semibold text-on-secondary-container">
							<span className="relative flex size-2">
								<span
									className={[
										"absolute inline-flex size-full rounded-full bg-secondary opacity-60",
										live ? "animate-ping" : "",
									].join(" ")}
								/>
								<span className="relative inline-flex size-2 rounded-full bg-secondary" />
							</span>
							{live ? "Live" : "Connected"}
						</span>
						<button
							type="button"
							aria-label="Restart session"
							title="Restart session"
							className="inline-flex size-10 items-center justify-center rounded-[10px] text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50"
							disabled={connecting || viewOnly}
							onClick={() => {
								onRestart();
							}}
						>
							<svg
								aria-hidden="true"
								className={["size-[18px]", connecting ? "animate-spin" : ""].join(" ")}
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
							>
								<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
								<path d="M3 3v5h5" />
							</svg>
						</button>
						<button
							type="button"
							className="inline-flex min-h-10 items-center gap-1.5 rounded-[10px] px-3 text-body-md font-semibold text-error transition-colors hover:bg-error-container/50 disabled:opacity-50"
							disabled={connecting || viewOnly}
							onClick={() => {
								onDisconnect();
							}}
						>
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
							>
								<path d="M12 3v9" />
								<path d="M6.3 6.3a8 8 0 1 0 11.4 0" />
							</svg>
							Disconnect
						</button>
					</>
				) : (
					<>
						<Button
							isDisabled={!device || connecting}
							size="sm"
							variant="primary"
							onPress={() => {
								onConnect();
							}}
						>
							{connecting ? "Connecting…" : "Connect"}
						</Button>
						{canRestart && device ? (
							<Button
								isDisabled={connecting}
								size="sm"
								variant="secondary"
								onPress={() => {
									onRestart();
								}}
							>
								{connecting ? "Restarting…" : "Restart session"}
							</Button>
						) : null}
					</>
				)}
				<ServersDoctorPanel onOpenChange={setServersOpen} open={serversOpen} />
			</div>

			{viewOnly ? (
				<p className="text-helper text-on-surface-variant">
					Test run in progress — watching live. Manual control resumes when the run finishes.
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
