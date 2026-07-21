import { ListBox, Select } from "@heroui/react";
import { type SVGProps, useState } from "react";

const DEVICES = [
	{ id: "iphone-16", label: "iPhone 16" },
	{ id: "iphone-15-pro", label: "iPhone 15 Pro" },
	{ id: "pixel-8", label: "Pixel 8" },
	{ id: "pixel-9", label: "Pixel 9" },
] as const;

const BUILDS = [
	{ id: "tf-128", label: "TestFlight #128" },
	{ id: "local-1.2.0", label: "1.2.0 (local)" },
	{ id: "ci-8921", label: "CI build #8921" },
	{ id: "store-1.1.4", label: "App Store 1.1.4" },
] as const;

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

export function RunsPanel() {
	const [deviceId, setDeviceId] = useState<string | null>(null);
	const [buildId, setBuildId] = useState<string | null>(null);
	const [deviceOpen, setDeviceOpen] = useState(false);
	const [buildOpen, setBuildOpen] = useState(false);

	return (
		<header className="flex w-full shrink-0 items-center justify-between gap-4 rounded-[var(--radius-platform)] bg-surface-container-lowest/90 px-4 py-3 shadow-soft backdrop-blur-md">
			<div className="blob-actions flex shrink-0 items-center gap-4 px-5 py-3.5 shadow-card">
				<button
					aria-expanded={deviceOpen}
					aria-haspopup="listbox"
					aria-label="Select device"
					className="text-white/90 transition-opacity hover:opacity-100"
					onClick={() => {
						setBuildOpen(false);
						setDeviceOpen(true);
					}}
					title="Select device"
					type="button"
				>
					<PhoneIcon className="size-5" />
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
				<Select
					aria-label="Select device"
					className="w-[11.5rem]"
					isOpen={deviceOpen}
					placeholder="Select device"
					selectedKey={deviceId}
					onOpenChange={setDeviceOpen}
					onSelectionChange={(key) => setDeviceId(key == null ? null : String(key))}
				>
					<Select.Trigger className="h-10 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 shadow-none">
						<span className="text-on-surface-variant">
							<PhoneIcon />
						</span>
						<Select.Value />
						<Select.Indicator className="text-on-surface-variant" />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{DEVICES.map((device) => (
								<ListBox.Item id={device.id} key={device.id} textValue={device.label}>
									{device.label}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>

				<Select
					aria-label="Select build"
					className="w-[11.5rem]"
					isOpen={buildOpen}
					placeholder="Select build"
					selectedKey={buildId}
					onOpenChange={setBuildOpen}
					onSelectionChange={(key) => setBuildId(key == null ? null : String(key))}
				>
					<Select.Trigger className="h-10 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 shadow-none">
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
					disabled={!deviceId || !buildId}
					title={!deviceId || !buildId ? "Select a device and build to run" : "Run tests"}
					type="button"
				>
					<svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
						<path d="M8 5.5v13l11-6.5L8 5.5Z" />
					</svg>
				</button>
			</div>
		</header>
	);
}
