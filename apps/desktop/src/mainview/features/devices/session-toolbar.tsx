import {
	type DevicePlatform,
	SelectDeviceModal,
	type SelectedDevice,
} from "@/features/devices/select-device-modal";
import { ServersDoctorPanel } from "@/features/devices/servers-doctor-panel";
import { sessionPillLabel } from "@/features/devices/session-status";
import { resolveTheme } from "@/features/settings/ui-preferences";
import { useThemeMode } from "@/features/settings/use-theme-mode";
import { Button, ListBox, Select } from "@heroui/react";
import type { ActiveDeviceResponse } from "@yoqa/runner-client";
import { type ReactNode, type SVGProps, useState, useSyncExternalStore } from "react";

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
	"motion-fade-in inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant px-3 text-xs font-medium text-on-surface transition-colors hover:bg-hover-surface disabled:opacity-50";

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

function subscribeOsDark(onChange: () => void) {
	const media = window.matchMedia("(prefers-color-scheme: dark)");
	media.addEventListener("change", onChange);
	return () => media.removeEventListener("change", onChange);
}

function ThemeToggle() {
	const [mode, setMode] = useThemeMode();
	const osDark = useSyncExternalStore(
		subscribeOsDark,
		() => window.matchMedia("(prefers-color-scheme: dark)").matches,
	);
	const effective = resolveTheme(mode, osDark);
	const button = (theme: "light" | "dark", label: string, icon: ReactNode) => {
		const pressed = effective === theme;
		return (
			<button
				aria-label={label}
				aria-pressed={pressed}
				className={[
					"flex h-[26px] w-7 items-center justify-center rounded-md",
					pressed ? "bg-surface-container-high text-on-surface" : "text-outline",
				].join(" ")}
				onClick={() => setMode(theme)}
				title={label}
				type="button"
			>
				<svg
					aria-hidden="true"
					className="size-[15px]"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="1.9"
					viewBox="0 0 24 24"
				>
					{icon}
				</svg>
			</button>
		);
	};

	return (
		<fieldset
			aria-label="Color theme"
			className="m-0 flex h-8 items-center gap-0.5 rounded-lg border border-outline-variant bg-surface-container-low p-0.5"
		>
			{button(
				"light",
				"Light mode",
				<>
					<circle cx="12" cy="12" r="4" />
					<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
				</>,
			)}
			{button("dark", "Dark mode", <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />)}
		</fieldset>
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
	onConnect,
	onRestart,
	onDisconnect,
	viewOnly,
}: SessionToolbarProps) {
	const [pickerOpen, setPickerOpen] = useState(false);
	const [serversOpen, setServersOpen] = useState(false);
	const connected = active != null;
	const canRestart = connected || device != null;
	/** A session's device the list does not have yet shows by its id. */
	const deviceLabel = device?.label ?? active?.deviceId;

	const platformLabel = PLATFORMS.find((item) => item.id === platform)?.label ?? platform;

	return (
		<div className="flex shrink-0 items-center gap-2">
			{connected && !viewOnly ? (
				<span
					className="motion-scale-in inline-flex h-8 max-w-52 items-center gap-1.5 rounded-lg bg-secondary-container/70 px-2.5 text-xs font-medium text-on-secondary-container"
					title={[sessionPillLabel(active), active.laneWarning].filter(Boolean).join(" — ")}
				>
					<PhoneIcon />
					<span className="truncate">
						{platformLabel} · {deviceLabel}
					</span>
				</span>
			) : connected ? (
				<span
					className="motion-scale-in inline-flex h-8 max-w-52 items-center gap-1.5 rounded-lg bg-surface-container px-2.5 text-xs text-on-surface-variant"
					title="A test run holds this device"
				>
					<PhoneIcon />
					<span className="truncate">
						{platformLabel} · {deviceLabel}
					</span>
					<LockIcon />
				</span>
			) : (
				<div className="motion-fade-in flex h-8 items-center rounded-lg border border-outline-variant bg-surface-container-low text-[13px]">
					<Select
						aria-label="Platform"
						className="w-[4.5rem]"
						isDisabled={connecting}
						onSelectionChange={(key) => {
							if (key === "ios" || key === "android") onPlatformChange(key);
						}}
						selectedKey={platform}
					>
						<Select.Trigger className="h-8 border-0 bg-transparent px-2.5 text-[13px] shadow-none">
							<Select.Value />
							<Select.Indicator />
						</Select.Trigger>
						<Select.Popover>
							<ListBox>
								{PLATFORMS.map((item) => (
									<ListBox.Item id={item.id} key={item.id} textValue={item.label}>
										{item.label}
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>
					<span aria-hidden="true" className="h-4 w-px bg-outline-variant" />
					<Button
						className={[
							"h-8 min-w-36 max-w-52 justify-start bg-transparent px-2.5 text-[13px] text-on-surface-variant shadow-none",
							deviceLabel ? "font-mono" : "",
						].join(" ")}
						isDisabled={connecting}
						onPress={() => setPickerOpen(true)}
						size="sm"
						variant="ghost"
					>
						<PhoneIcon />
						<span className="truncate">{deviceLabel ?? "Select device"}</span>
					</Button>
				</div>
			)}

			<ServersDoctorPanel onOpenChange={setServersOpen} open={serversOpen} />
			<ThemeToggle />

			{connected ? (
				viewOnly ? null : (
					<>
						<button
							type="button"
							className={RESTART_BUTTON_CLASS}
							disabled={connecting}
							onClick={() => {
								onRestart();
							}}
						>
							<RestartIcon spinning={connecting} />
							Restart session
						</button>
						<button
							type="button"
							className="motion-fade-in inline-flex h-8 items-center gap-1.5 rounded-lg border border-error/30 px-3 text-xs font-medium text-error transition-colors hover:bg-error-container/50 disabled:opacity-50"
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
								onRestart();
							}}
						>
							<RestartIcon spinning={connecting} />
							{connecting ? "Restarting…" : "Restart session"}
						</button>
					) : null}
					<button
						type="button"
						className="motion-press motion-fade-in inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-semibold text-on-primary transition-opacity disabled:opacity-40"
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
