import { getDesktopRpc } from "@/app/desktop-rpc";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { doctorQueryKey } from "@/features/devices/servers-doctor-panel";
import { Button, ListBox, Select, Tabs } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { type ReactNode, type SVGProps, useEffect, useMemo, useState } from "react";
import type { CliEnvironmentSnapshot } from "../../../shared/cli-environment";
import type {
	IosToolchainSnapshot,
	SigningIdentity,
	SigningTier,
	XcodeInstallation,
} from "../../../shared/ios-toolchain";
import { ProvidersSection } from "./providers/providers-section";

type SettingsSection = "ios" | "cli" | "provider" | "diagnostics";
type IdentityFilter = "all" | SigningTier;

const SECTIONS: { id: SettingsSection; label: string }[] = [
	{ id: "ios", label: "iOS" },
	{ id: "cli", label: "CLI & Agents" },
	{ id: "provider", label: "Provider" },
	{ id: "diagnostics", label: "Diagnostics" },
];

const IOS_TOOLCHAIN_QUERY_KEY = ["ios-toolchain"] as const;
const CLI_ENVIRONMENT_QUERY_KEY = ["cli-environment"] as const;

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
		<div className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
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
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">Settings for running local iOS tests.</p>

			<SectionCard>
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
						<Select.Trigger className="h-12 w-full items-center gap-3 rounded-xl border border-outline-variant bg-surface-container px-3.5 shadow-none">
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
			</SectionCard>

			<SectionCard>
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
								<Select.Trigger className="h-12 w-full items-center gap-3 rounded-xl border border-outline-variant bg-surface-container px-3.5 shadow-none">
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
						<li>
							No manual portal registration — keep the device connected so Xcode can register it
							during the first WebDriverAgent build
						</li>
						<li>
							On first use, trust the certificate in Settings → General → VPN & Device Management
						</li>
					</ul>
				</div>
			</SectionCard>
		</div>
	);
}

function CliSettings({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();
	const [cliError, setCliError] = useState<string | null>(null);
	const [skillError, setSkillError] = useState<string | null>(null);
	const [openError, setOpenError] = useState<string | null>(null);

	const envQuery = useQuery({
		queryKey: CLI_ENVIRONMENT_QUERY_KEY,
		enabled,
		queryFn: async () => getDesktopRpc().request.getCliEnvironment(),
		staleTime: 10_000,
	});

	const snapshot = envQuery.data;

	const installCliMutation = useMutation({
		mutationFn: async () => getDesktopRpc().request.installCli(),
		onSuccess: (result) => {
			if (!result.ok) {
				setCliError(result.error);
				return;
			}
			setCliError(null);
			void queryClient.invalidateQueries({ queryKey: CLI_ENVIRONMENT_QUERY_KEY });
		},
		onError: (error) => {
			setCliError(error instanceof Error ? error.message : String(error));
		},
	});

	const installSkillMutation = useMutation({
		mutationFn: async () => getDesktopRpc().request.installSkill(),
		onSuccess: (result) => {
			if (!result.ok) {
				setSkillError(result.error);
				return;
			}
			setSkillError(null);
			queryClient.setQueryData<CliEnvironmentSnapshot>(CLI_ENVIRONMENT_QUERY_KEY, (current) => {
				if (!current) return current;
				return {
					...current,
					skill: {
						...current.skill,
						installed: true,
						installDir: result.installDir,
						targets: result.targets,
					},
				};
			});
		},
		onError: (error) => {
			setSkillError(error instanceof Error ? error.message : String(error));
		},
	});

	const openFolderMutation = useMutation({
		mutationFn: async () => getDesktopRpc().request.openSkillFolder(),
		onSuccess: (result) => {
			if (!result.ok) {
				setOpenError(result.error);
				return;
			}
			setOpenError(null);
		},
		onError: (error) => {
			setOpenError(error instanceof Error ? error.message : String(error));
		},
	});

	const cliInstalled = snapshot?.cli.status === "installed";
	const cliButtonLabel = installCliMutation.isPending
		? "Installing…"
		: cliInstalled
			? "Reinstall"
			: "Install";
	const skillButtonLabel = installSkillMutation.isPending
		? "Installing…"
		: snapshot?.skill.targets.every((t) => t.status === "linked")
			? "Reinstall"
			: "Install";

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">
				Tools for terminal and AI agent integrations.
			</p>

			{envQuery.isLoading ? (
				<p className="text-body-md text-on-surface-variant">Checking install status…</p>
			) : envQuery.isError ? (
				<p className="text-body-md text-error">Could not load CLI & Agents status.</p>
			) : null}

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
						{cliInstalled && snapshot.cli.status === "installed" ? (
							<p className="mt-2 font-mono text-helper text-on-surface-variant">
								Installed at {snapshot.cli.path}
							</p>
						) : snapshot?.cli.status === "foreign" ? (
							<p className="mt-2 text-body-sm text-error">
								A different yoqa exists at {snapshot.cli.path}. Remove it before installing.
							</p>
						) : null}
						{snapshot?.cli.pathHint ? (
							<p className="mt-2 text-body-sm text-on-surface-variant">{snapshot.cli.pathHint}</p>
						) : null}
						{cliError ? <p className="mt-2 text-body-sm text-error">{cliError}</p> : null}
					</div>
					<Button
						className="shrink-0"
						isDisabled={installCliMutation.isPending || snapshot?.cli.status === "foreign"}
						onPress={() => installCliMutation.mutate()}
						size="sm"
						variant="primary"
					>
						{cliButtonLabel}
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
								{(snapshot?.skill.targets ?? []).map((target) => (
									<li
										key={target.id}
										className="flex items-start gap-2 text-body-sm text-on-surface-variant"
									>
										<span
											aria-hidden="true"
											className={[
												"mt-0.5",
												target.status === "linked" ? "text-primary" : "text-outline",
											].join(" ")}
										>
											{target.status === "linked" ? "✓" : "×"}
										</span>
										<span>
											<span className="font-medium text-on-surface">{target.label}</span>{" "}
											<span className="font-mono text-helper">{target.displayPath}</span>
										</span>
									</li>
								))}
							</ul>
							{skillError ? <p className="mt-2 text-body-sm text-error">{skillError}</p> : null}
						</div>
						<Button
							className="shrink-0"
							isDisabled={installSkillMutation.isPending}
							onPress={() => installSkillMutation.mutate()}
							size="sm"
							variant="primary"
						>
							{skillButtonLabel}
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
						<Button
							className="gap-2"
							isDisabled={openFolderMutation.isPending}
							onPress={() => openFolderMutation.mutate()}
							size="sm"
							variant="secondary"
						>
							<FolderIcon />
							{openFolderMutation.isPending ? "Opening…" : "Open folder"}
						</Button>
					</div>
					{openError ? <p className="mt-2 text-body-sm text-error">{openError}</p> : null}
					<p className="mt-2 truncate font-mono text-helper text-on-surface-variant">
						{snapshot?.skill.displayInstallDir ??
							"~/Library/Application Support/yoqa/skills/yoqa-testing"}
					</p>
				</div>
			</SectionCard>
		</div>
	);
}

function DiagnosticsSettings({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();
	const doctorQuery = useQuery({
		queryKey: doctorQueryKey,
		queryFn: async () => (await getRunnerClient()).getDoctorReport(),
		enabled,
		refetchInterval: enabled ? 15_000 : false,
	});

	const repairMutation = useMutation({
		mutationFn: async () => {
			const report = doctorQuery.data;
			if (!report) throw new Error("No doctor report loaded");
			const repairs = [
				...new Set(
					report.steps
						.map((step) => step.repair)
						.filter((id): id is NonNullable<typeof id> => Boolean(id)),
				),
			];
			if (repairs.length === 0) {
				throw new Error("No safe repairs available");
			}
			return (await getRunnerClient()).repairDoctor({ repairs });
		},
		onSuccess: async (result) => {
			queryClient.setQueryData(doctorQueryKey, result.report);
			await queryClient.invalidateQueries({ queryKey: doctorQueryKey });
		},
		onError: (error) => showErrorToast(error, "Repair failed"),
	});

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">
				System checks for Node, Appium, drivers, host tools, and leftover processes. Same report as{" "}
				<code className="font-mono text-helper">yoqa doctor</code>.
			</p>

			<SectionCard>
				<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
					<div>
						<h3 className="text-subheading font-semibold text-on-surface">Doctor report</h3>
						<p className="mt-1 text-body-md text-on-surface-variant">
							{doctorQuery.isLoading
								? "Running checks…"
								: doctorQuery.data?.ok
									? "All required checks passed"
									: "Some required checks need attention"}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							isDisabled={doctorQuery.isFetching}
							onPress={() => void doctorQuery.refetch()}
							variant="secondary"
						>
							Refresh
						</Button>
						<Button
							isDisabled={
								repairMutation.isPending || !doctorQuery.data?.steps.some((step) => step.repair)
							}
							onPress={() => repairMutation.mutate()}
							variant="primary"
						>
							{repairMutation.isPending ? "Repairing…" : "Repair safe issues"}
						</Button>
					</div>
				</div>

				{doctorQuery.isError ? (
					<p className="text-body-md text-error">
						Could not load doctor report. Is the local runner up?
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{(doctorQuery.data?.checks ?? []).map((check) => (
							<li
								className="flex items-start justify-between gap-3 rounded-xl bg-surface-container px-3.5 py-3"
								key={check.id}
							>
								<div className="min-w-0">
									<p className="text-body-md font-medium text-on-surface">{check.label}</p>
									{check.detail ? (
										<p className="mt-0.5 text-body-sm text-on-surface-variant">{check.detail}</p>
									) : null}
									{check.fixHint && check.status !== "pass" ? (
										<p className="mt-1 text-helper text-on-surface-variant">{check.fixHint}</p>
									) : null}
								</div>
								<span
									className={[
										"shrink-0 rounded-full px-2 py-0.5 text-helper font-medium",
										check.status === "pass"
											? "bg-primary/15 text-primary"
											: check.status === "fail"
												? "bg-error/15 text-error"
												: "bg-surface-container-high text-on-surface-variant",
									].join(" ")}
								>
									{check.status}
								</span>
							</li>
						))}
					</ul>
				)}
			</SectionCard>

			{doctorQuery.data && doctorQuery.data.steps.length > 0 ? (
				<SectionCard>
					<h3 className="text-subheading font-semibold text-on-surface">Next steps</h3>
					<ul className="mt-3 flex flex-col gap-2">
						{doctorQuery.data.steps.map((step) => (
							<li
								className="rounded-xl bg-surface-container px-3.5 py-3"
								key={`${step.title}-${step.detail}`}
							>
								<p className="text-body-md font-medium text-on-surface">
									[{step.severity}] {step.title}
								</p>
								<p className="mt-0.5 text-body-sm text-on-surface-variant">{step.detail}</p>
							</li>
						))}
					</ul>
				</SectionCard>
			) : null}
		</div>
	);
}

export function SettingsPage() {
	const search = useSearch({ from: "/settings" });
	const initial =
		search.section === "ios" ||
		search.section === "cli" ||
		search.section === "provider" ||
		search.section === "diagnostics"
			? search.section
			: "ios";
	const [section, setSection] = useState<SettingsSection>(initial);

	useEffect(() => {
		if (
			search.section === "ios" ||
			search.section === "cli" ||
			search.section === "provider" ||
			search.section === "diagnostics"
		) {
			setSection(search.section);
		}
	}, [search.section]);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
			<header>
				<h1 className="text-headline-lg text-on-surface">Settings</h1>
			</header>

			<Tabs
				className="w-full"
				onSelectionChange={(key) => setSection(String(key) as SettingsSection)}
				selectedKey={section}
			>
				<Tabs.ListContainer>
					<Tabs.List
						aria-label="Settings sections"
						className="relative w-fit max-w-full gap-1 rounded-xl bg-surface-container p-1"
					>
						{SECTIONS.map((item) => (
							<Tabs.Tab
								className="relative z-[1] h-auto min-h-9 rounded-lg px-3.5 py-1.5 text-body-sm font-medium text-on-surface-variant transition-[color,opacity] duration-[var(--motion-fast)] data-[selected=true]:font-semibold data-[selected=true]:!text-on-surface"
								id={item.id}
								key={item.id}
							>
								{item.label}
								<Tabs.Indicator className="-z-10 rounded-lg bg-surface-container-lowest shadow-card" />
							</Tabs.Tab>
						))}
					</Tabs.List>
				</Tabs.ListContainer>

				<Tabs.Panel className="pt-6" id="ios">
					<IosSettings enabled={section === "ios"} />
				</Tabs.Panel>
				<Tabs.Panel className="pt-6" id="cli">
					<CliSettings enabled={section === "cli"} />
				</Tabs.Panel>
				<Tabs.Panel className="pt-6" id="provider">
					<ProvidersSection enabled={section === "provider"} />
				</Tabs.Panel>
				<Tabs.Panel className="pt-6" id="diagnostics">
					<DiagnosticsSettings enabled={section === "diagnostics"} />
				</Tabs.Panel>
			</Tabs>
		</div>
	);
}
