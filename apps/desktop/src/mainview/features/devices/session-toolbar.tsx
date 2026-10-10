import {
	type DevicePlatform,
	SelectDeviceModal,
	type SelectedDevice,
} from "@/features/devices/select-device-modal";
import { ServersDoctorPanel } from "@/features/devices/servers-doctor-panel";
import { sessionPillLabel } from "@/features/devices/session-status";
import { Button, Dropdown, Label, ListBox, Select } from "@heroui/react";
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

function RestartIcon({ spinning }: { spinning: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className={["size-[18px]", spinning ? "animate-spin" : ""].join(" ")}
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
	);
}

const RESTART_BUTTON_CLASS =
	"motion-fade-in inline-flex h-10 items-center gap-2 rounded-xl border border-outline-variant px-4 text-body-md font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50";

function LockIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-3.5 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<rect height="10" rx="2" width="14" x="5" y="11" />
			<path d="M8 11V8a4 4 0 0 1 8 0v3" />
		</svg>
	);
}

function PlugIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-4"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			<path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v5" />
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
	onConnect: () => void;
	onRestart: (options: { rebuildWda: boolean }) => void;
	onDisconnect: () => void;
	/** A Run owns the shared session — watch-only until it finishes. */
	viewOnly: boolean;
	/** Restart also offers to rebuild WebDriverAgent (an iOS session on the Appium lane). */
	offerWdaRebuild: boolean;
};

export function SessionToolbar({
	platform,
	onPlatformChange,
	device,
	onDeviceSelect,
	active,
	connecting,
	onConnect,
	onRestart,
	onDisconnect,
	viewOnly,
	offerWdaRebuild,
}: SessionToolbarProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [serversOpen, setServersOpen] = useState(false);
	const connected = active != null;
	const canRestart = connected || device != null;
	/** A session's device the list does not have yet shows by its id. */
	const deviceLabel = device?.label ?? active?.deviceId;

	const platformLabel = PLATFORMS.find((item) => item.id === platform)?.label ?? platform;

	return (
		<div className="flex flex-wrap items-center justify-end gap-3">
			{connected && !viewOnly ? (
				<span
					className="motion-scale-in inline-flex h-10 max-w-64 items-center gap-2 rounded-xl bg-secondary-container/70 px-3 text-body-md font-semibold text-on-secondary-container"
					title={[sessionPillLabel(active), active.laneWarning].filter(Boolean).join(" — ")}
				>
					<PhoneIcon />
					<span className="truncate">
						{platformLabel} · {deviceLabel}
					</span>
				</span>
			) : connected ? (
				<span
					className="motion-scale-in inline-flex h-10 max-w-64 items-center gap-2 rounded-xl bg-surface-container px-3 text-body-md text-on-surface-variant"
					title="A test run holds this device"
				>
					<PhoneIcon />
					<span className="truncate">
						{platformLabel} · {deviceLabel}
					</span>
					<LockIcon />
				</span>
			) : (
				<div className="motion-fade-in flex h-10 items-center rounded-xl bg-surface-container pr-1">
					<Select
						aria-label="Platform"
						className="w-28"
						isDisabled={connecting}
						selectedKey={platform}
						onSelectionChange={(key) => {
							if (key === "ios" || key === "android") onPlatformChange(key);
						}}
					>
						<Select.Trigger className="h-10 border-0 bg-transparent shadow-none">
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
					<span aria-hidden="true" className="h-5 w-px bg-outline-variant" />
					<Button
						className={[
							"h-10 min-w-44 max-w-56 justify-start bg-transparent shadow-none",
							deviceLabel ? "font-mono text-body-sm" : "",
						].join(" ")}
						isDisabled={connecting}
						size="sm"
						variant="ghost"
						onPress={() => setPickerOpen(true)}
					>
						<PhoneIcon />
						<span className="truncate">{deviceLabel ?? "Select device"}</span>
					</Button>
				</div>
			)}

			<ServersDoctorPanel onOpenChange={setServersOpen} open={serversOpen} />

			{connected ? (
				viewOnly ? null : (
					<>
						{offerWdaRebuild ? (
							<Dropdown>
								<Button
									aria-label="Restart session"
									className={RESTART_BUTTON_CLASS}
									isDisabled={connecting}
									variant="ghost"
								>
									<RestartIcon spinning={connecting} />
									Restart session
								</Button>
								<Dropdown.Popover className="w-72">
									<Dropdown.Menu
										onAction={(key) => {
											onRestart({ rebuildWda: String(key) === "restart-rebuild-wda" });
										}}
									>
										<Dropdown.Item id="restart" textValue="Restart session">
											<Label>Restart session</Label>
										</Dropdown.Item>
										<Dropdown.Item
											id="restart-rebuild-wda"
											textValue="Restart & rebuild WebDriverAgent"
										>
											<Label>Restart &amp; rebuild WebDriverAgent</Label>
										</Dropdown.Item>
									</Dropdown.Menu>
								</Dropdown.Popover>
							</Dropdown>
						) : (
							<button
								type="button"
								className={RESTART_BUTTON_CLASS}
								disabled={connecting}
								onClick={() => {
									onRestart({ rebuildWda: false });
								}}
							>
								<RestartIcon spinning={connecting} />
								Restart session
							</button>
						)}
						<button
							type="button"
							className="motion-fade-in inline-flex h-10 items-center gap-2 rounded-xl border border-error/30 px-4 text-body-md font-semibold text-error transition-colors hover:bg-error-container/50 disabled:opacity-50"
							disabled={connecting}
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
				)
			) : (
				<>
					{canRestart && device ? (
						<button
							type="button"
							className={RESTART_BUTTON_CLASS}
							disabled={connecting}
							onClick={() => {
								onRestart({ rebuildWda: false });
							}}
						>
							<RestartIcon spinning={connecting} />
							{connecting ? "Restarting…" : "Restart session"}
						</button>
					) : null}
					<button
						type="button"
						className="motion-press motion-fade-in inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-body-md font-semibold text-on-primary transition-opacity disabled:opacity-40"
						disabled={!device || connecting}
						onClick={() => {
							onConnect();
						}}
					>
						<PlugIcon />
						{connecting ? "Connecting…" : "Connect"}
					</button>
				</>
			)}

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
