import { getDesktopRpc } from "@/app/desktop-rpc";
import { Button, ListBox, Modal, Select } from "@heroui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, type SVGProps, useEffect, useMemo, useState } from "react";
import type {
	IosToolchainSnapshot,
	SigningIdentity,
	SigningTier,
	XcodeInstallation,
} from "../../../shared/ios-toolchain";

type SettingsSection = "ios" | "cli";
type IdentityFilter = "all" | SigningTier;

type SettingsModalProps = {
	open: boolean;
	onClose: () => void;
};

const SECTIONS: { id: SettingsSection; label: string }[] = [
	{ id: "ios", label: "iOS" },
	{ id: "cli", label: "CLI & Agents" },
];

const SKILL_TARGETS = [
	{ id: "standard", label: "Standard", path: "~/.agents/skills/yoqa-testing" },
	{ id: "claude", label: "Claude", path: "~/.claude/skills/yoqa-testing" },
	{ id: "cursor", label: "Cursor", path: "~/.cursor/skills/yoqa-testing" },
	{ id: "codex", label: "Codex", path: "~/.codex/skills/yoqa-testing" },
] as const;

const SKILL_FOLDER = "~/Library/Application Support/yoqa/skills/yoqa-testing";

const IOS_TOOLCHAIN_QUERY_KEY = ["ios-toolchain"] as const;

function Icon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			viewBox="0 0 24 24"
			{...props}
		/>
	);
}

function TerminalIcon() {
	return (
		<Icon>
			<path d="M4 17l6-5-6-5M12 19h8" strokeLinecap="round" strokeLinejoin="round" />
		</Icon>
	);
}

function BookIcon() {
	return (
		<Icon>
			<path
				d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 016.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</Icon>
	);
}

function FolderIcon() {
	return (
		<svg
			aria-hidden="true"
			className="size-4 shrink-0"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
		>
			<path
				d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function XcodeMark() {
	return (
		<span
			aria-hidden="true"
			className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#147EFB] to-[#0A84FF] text-[10px] font-bold text-white"
		>
			X
		</span>
	);
}

function TierBadge({ tier }: { tier: SigningTier }) {
	return (
		<span
			className={[
				"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
				tier === "Paid"
					? "bg-[#147EFB] text-white"
					: "bg-surface-container-high text-on-surface-variant",
			].join(" ")}
		>
			{tier}
		</span>
	);
}

function SectionCard({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-xl border border-outline-variant bg-surface-container-lowest p-4">
			{children}
		</div>
	);
}

function xcodeLabel(item: XcodeInstallation): string {
	return `${item.appName} ${item.version}`;
}

function IdentityFilterBar({
	value,
	counts,
	onChange,
}: {
	value: IdentityFilter;
	counts: { all: number; Paid: number; Personal: number };
	onChange: (next: IdentityFilter) => void;
}) {
	const options: { id: IdentityFilter; label: string; count: number }[] = [
		{ id: "all", label: "All", count: counts.all },
		{ id: "Paid", label: "Paid", count: counts.Paid },
		{ id: "Personal", label: "Personal", count: counts.Personal },
	];

	return (
		<div className="mb-3 flex flex-wrap gap-1.5">
			{options.map((option) => {
				const isActive = option.id === value;
				return (
					<button
						key={option.id}
						className={[
							"rounded-full px-3 py-1 text-body-sm transition-colors",
							isActive
								? "bg-primary font-semibold text-on-primary"
								: "bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
						].join(" ")}
						onClick={() => onChange(option.id)}
						type="button"
					>
						{option.label}
						<span className="ml-1.5 opacity-70">{option.count}</span>
					</button>
				);
			})}
		</div>
	);
}

function IosSettings({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();
	const [tierFilter, setTierFilter] = useState<IdentityFilter>("all");
	const [xcodeId, setXcodeId] = useState<string | null>(null);
	const [signingId, setSigningId] = useState<string | null>(null);

	const toolchainQuery = useQuery({
		queryKey: IOS_TOOLCHAIN_QUERY_KEY,
		enabled,
		queryFn: async () => getDesktopRpc().request.getIosToolchain(),
		staleTime: 30_000,
	});

	useEffect(() => {
		if (!toolchainQuery.data) return;
		setXcodeId(toolchainQuery.data.preferences.xcodeDeveloperDir);
		setSigningId(toolchainQuery.data.preferences.signingIdentityHash);
	}, [toolchainQuery.data]);

	const xcodes = toolchainQuery.data?.xcodes ?? [];
	const identities = toolchainQuery.data?.identities ?? [];

	const filteredIdentities = useMemo(() => {
		if (tierFilter === "all") return identities;
		return identities.filter((item) => item.tier === tierFilter);
	}, [identities, tierFilter]);

	const selectedXcode = xcodes.find((item) => item.id === xcodeId) ?? null;
	const selectedSigning =
		identities.find((item) => item.id === signingId) ??
		filteredIdentities.find((item) => item.id === signingId) ??
		null;

	const counts = useMemo(
		() => ({
			all: identities.length,
			Paid: identities.filter((item) => item.tier === "Paid").length,
			Personal: identities.filter((item) => item.tier === "Personal").length,
		}),
		[identities],
	);

	const persistSelection = async (next: {
		xcodeDeveloperDir?: string | null;
		signingIdentityHash?: string | null;
	}) => {
		const preferences = await getDesktopRpc().request.setIosToolchainSelection(next);
		queryClient.setQueryData<IosToolchainSnapshot>(IOS_TOOLCHAIN_QUERY_KEY, (current) => {
			if (!current) return current;
			return { ...current, preferences };
		});
	};

	const handleXcodeChange = (key: string | null) => {
		if (key == null) return;
		setXcodeId(key);
		void persistSelection({ xcodeDeveloperDir: key });
	};

	const handleSigningChange = (key: string | null) => {
		if (key == null) return;
		setSigningId(key);
		void persistSelection({ signingIdentityHash: key });
	};

	return (
		<div className="flex flex-col gap-8">
			<header>
				<h2 className="text-headline-lg text-on-surface">iOS</h2>
				<p className="mt-1 text-body-md text-on-surface-variant">
					Settings for running local iOS tests.
				</p>
			</header>

			<section>
				<h3 className="text-subheading font-semibold text-on-surface">Xcode</h3>
				<p className="mt-1 mb-3 text-body-md text-on-surface-variant">
					Toolchain used to build and run iOS tests. Auto-detected; change to use a different
					installed Xcode.
				</p>
				{toolchainQuery.isLoading ? (
					<p className="text-body-md text-on-surface-variant">Scanning installed Xcode…</p>
				) : toolchainQuery.isError ? (
					<p className="text-body-md text-error">
						Could not scan Xcode installations. Open Settings again after Xcode is installed.
					</p>
				) : xcodes.length === 0 ? (
					<p className="text-body-md text-on-surface-variant">
						No Xcode apps found in /Applications. Install Xcode from the App Store.
					</p>
				) : (
					<Select
						aria-label="Xcode"
						selectedKey={xcodeId}
						onSelectionChange={(key) => handleXcodeChange(key == null ? null : String(key))}
					>
						<Select.Trigger className="h-12 w-full items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 shadow-none">
							<Select.Value>
								{({ isPlaceholder }) =>
									isPlaceholder || !selectedXcode ? (
										"Select Xcode"
									) : (
										<span className="flex min-w-0 items-center gap-2.5">
											<XcodeMark />
											<span className="truncate text-body-md text-on-surface">
												<span className="font-medium">{xcodeLabel(selectedXcode)}</span>{" "}
												<span className="text-on-surface-variant">
													{selectedXcode.developerDir}
												</span>
											</span>
										</span>
									)
								}
							</Select.Value>
							<Select.Indicator className="text-on-surface-variant" />
						</Select.Trigger>
						<Select.Popover>
							<ListBox>
								{xcodes.map((item) => (
									<ListBox.Item
										id={item.id}
										key={item.id}
										textValue={`${xcodeLabel(item)} ${item.developerDir}`}
									>
										<span className="flex min-w-0 items-center gap-2.5">
											<XcodeMark />
											<span className="truncate">
												<span className="font-medium">{xcodeLabel(item)}</span>{" "}
												<span className="text-on-surface-variant">{item.developerDir}</span>
											</span>
										</span>
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>
				)}
			</section>

			<section>
				<h3 className="text-subheading font-semibold text-on-surface">Code Signing Identity</h3>
				<p className="mt-1 mb-3 text-body-md text-on-surface-variant">
					Certificate used to sign the app when running tests on a real device.
				</p>

				{toolchainQuery.isLoading ? (
					<p className="text-body-md text-on-surface-variant">Scanning code signing identities…</p>
				) : toolchainQuery.isError ? (
					<p className="text-body-md text-error">
						Could not read signing certificates from Keychain.
					</p>
				) : identities.length === 0 ? (
					<p className="text-body-md text-on-surface-variant">
						No Apple Development certificates found. Sign in to Xcode → Settings → Accounts and
						create a certificate.
					</p>
				) : (
					<>
						<IdentityFilterBar counts={counts} onChange={setTierFilter} value={tierFilter} />
						{filteredIdentities.length === 0 ? (
							<p className="text-body-md text-on-surface-variant">
								No {tierFilter === "all" ? "" : `${tierFilter.toLowerCase()} `}certificates match
								this filter.
							</p>
						) : (
							<Select
								aria-label="Code Signing Identity"
								selectedKey={
									filteredIdentities.some((item) => item.id === signingId) ? signingId : null
								}
								onSelectionChange={(key) => handleSigningChange(key == null ? null : String(key))}
							>
								<Select.Trigger className="h-12 w-full items-center gap-3 rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 shadow-none">
									<Select.Value>
										{({ isPlaceholder }) => {
											const visible =
												selectedSigning &&
												filteredIdentities.some((item) => item.id === selectedSigning.id)
													? selectedSigning
													: null;
											return isPlaceholder || !visible ? (
												"Select identity"
											) : (
												<span className="flex min-w-0 items-center gap-2.5">
													<TierBadge tier={visible.tier} />
													<span className="truncate text-body-md text-on-surface">
														{visible.label}
													</span>
												</span>
											);
										}}
									</Select.Value>
									<Select.Indicator className="text-on-surface-variant" />
								</Select.Trigger>
								<Select.Popover className="max-h-80">
									<ListBox>
										{filteredIdentities.map((item: SigningIdentity) => (
											<ListBox.Item id={item.id} key={item.id} textValue={item.label}>
												<span className="flex min-w-0 items-center gap-2.5">
													<TierBadge tier={item.tier} />
													<span className="truncate">{item.label}</span>
												</span>
												<ListBox.ItemIndicator />
											</ListBox.Item>
										))}
									</ListBox>
								</Select.Popover>
							</Select>
						)}
					</>
				)}

				<div className="mt-3 rounded-xl border border-outline-variant bg-surface-container-low/70 px-4 py-3.5 text-body-sm text-on-surface">
					<p className="font-semibold">Paid Apple Developer account</p>
					<ul className="mt-1 list-disc space-y-0.5 pl-5 text-on-surface-variant">
						<li>Device must be registered in your Apple Developer account</li>
						<li>The app build must be signed with the same Team ID</li>
					</ul>
					<p className="mt-3 font-semibold">Personal Apple Developer account</p>
					<ul className="mt-1 list-disc space-y-0.5 pl-5 text-on-surface-variant">
						<li>Works on any device without registration</li>
						<li>
							On first use, trust the certificate in Settings → General → VPN & Device Management
						</li>
					</ul>
				</div>
			</section>
		</div>
	);
}

function CliSettings() {
	return (
		<div className="flex flex-col gap-6">
			<header>
				<h2 className="text-headline-lg text-on-surface">CLI & Agents</h2>
				<p className="mt-1 text-body-md text-on-surface-variant">
					Tools for terminal and AI agent integrations.
				</p>
			</header>

			<SectionCard>
				<div className="flex items-start gap-3">
					<span className="mt-0.5 text-on-surface">
						<TerminalIcon />
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-subheading font-semibold text-on-surface">CLI Tool</p>
						<p className="mt-0.5 text-body-md text-on-surface-variant">
							Install the <code className="font-mono text-on-surface">yoqa</code> command to run
							tests from your terminal.
						</p>
					</div>
					<Button className="shrink-0" size="sm" variant="primary">
						Install
					</Button>
				</div>
			</SectionCard>

			<SectionCard>
				<div className="flex items-start gap-3">
					<span className="mt-0.5 text-on-surface">
						<BookIcon />
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-subheading font-semibold text-on-surface">Mobile Testing Skill</p>
						<p className="mt-0.5 text-body-md text-on-surface-variant">
							Teaches AI agents to run mobile tests through the{" "}
							<code className="font-mono text-on-surface">yoqa</code> command-line tool.
						</p>
					</div>
				</div>

				<div className="mt-5 border-t border-outline-variant pt-4">
					<div className="flex items-start justify-between gap-4">
						<div className="min-w-0 flex-1">
							<p className="text-body-md font-semibold text-on-surface">Install globally</p>
							<p className="mt-1 text-body-sm text-on-surface-variant">
								Symlinks the skill into your agent directories so every project can use it. Stays in
								sync automatically when the app updates.
							</p>
							<ul className="mt-3 space-y-2">
								{SKILL_TARGETS.map((target) => (
									<li
										key={target.id}
										className="flex items-start gap-2 text-body-sm text-on-surface-variant"
									>
										<span aria-hidden="true" className="mt-0.5 text-outline">
											×
										</span>
										<span>
											<span className="font-medium text-on-surface">{target.label}</span>{" "}
											<span className="font-mono text-helper">{target.path}</span>
										</span>
									</li>
								))}
							</ul>
						</div>
						<Button className="shrink-0" size="sm" variant="primary">
							Install
						</Button>
					</div>
				</div>

				<div className="mt-5 border-t border-outline-variant pt-4">
					<p className="text-body-md font-semibold text-on-surface">Install manually</p>
					<p className="mt-1 text-body-sm text-on-surface-variant">
						Open the skill folder, then symlink or copy it into any project or agent directory
						yourself.
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-3">
						<Button className="gap-2" size="sm" variant="secondary">
							<FolderIcon />
							Open folder
						</Button>
					</div>
					<p className="mt-2 truncate font-mono text-helper text-on-surface-variant">
						{SKILL_FOLDER}
					</p>
				</div>
			</SectionCard>
		</div>
	);
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
	const [section, setSection] = useState<SettingsSection>("ios");

	useEffect(() => {
		if (open) {
			setSection("ios");
		}
	}, [open]);

	return (
		<Modal>
			<Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onClose()} variant="opaque">
				<Modal.Container placement="center" scroll="inside" size="cover">
					<Modal.Dialog className="max-h-[min(40rem,90vh)] overflow-hidden p-0 sm:max-w-4xl">
						<Modal.CloseTrigger className="absolute top-4 right-4 z-10" />
						<Modal.Body className="flex min-h-0 flex-1 flex-row gap-0 p-0">
							<aside className="flex w-48 shrink-0 flex-col border-r border-outline-variant bg-surface-container-low/40 px-3 py-5">
								<p className="mb-3 px-3 text-label-caps uppercase text-on-surface-variant">
									Settings
								</p>
								<nav className="flex flex-col gap-0.5">
									{SECTIONS.map((item) => {
										const isActive = item.id === section;
										return (
											<button
												key={item.id}
												className={[
													"rounded-lg px-3 py-2 text-left text-body-md transition-colors",
													isActive
														? "bg-surface-container font-semibold text-on-surface"
														: "text-on-surface-variant hover:bg-surface-container/70 hover:text-on-surface",
												].join(" ")}
												onClick={() => setSection(item.id)}
												type="button"
											>
												{item.label}
											</button>
										);
									})}
								</nav>
							</aside>

							<div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-8 py-6">
								{section === "ios" ? (
									<IosSettings enabled={open && section === "ios"} />
								) : (
									<CliSettings />
								)}
							</div>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
