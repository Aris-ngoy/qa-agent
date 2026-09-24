import { getDesktopRpc } from "@/app/desktop-rpc";
import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { getRunnerClient } from "@/app/runner-client";
import { showErrorToast } from "@/app/show-error-toast";
import { doctorQueryKey } from "@/features/devices/servers-doctor-panel";
import {
	DoctorSeverityPill,
	DoctorStatusPill,
	doctorStatusRowClass,
	doctorStepSeverityClass,
} from "@/features/doctor/status-ui";
import {
	Button,
	Description,
	FieldError,
	Input,
	ListBox,
	Select,
	Spinner,
	Tabs,
	TextField,
} from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { type ReactNode, type SVGProps, useEffect, useMemo, useState } from "react";
import type {
	AndroidPathSource,
	AndroidToolchainSnapshot,
} from "../../../shared/android-toolchain";
import type { CliEnvironmentSnapshot } from "../../../shared/cli-environment";
import type {
	IosToolchainSnapshot,
	SigningIdentity,
	SigningTier,
	XcodeInstallation,
} from "../../../shared/ios-toolchain";
import { ProvidersSection } from "./providers/providers-section";

type SettingsSection = "ios" | "android" | "cli" | "provider" | "diagnostics";
type IdentityFilter = "all" | SigningTier;

const SETTINGS_SECTIONS: SettingsSection[] = ["ios", "android", "cli", "provider", "diagnostics"];

const SECTIONS: { id: SettingsSection; label: string }[] = [
	{ id: "ios", label: "iOS" },
	{ id: "android", label: "Android" },
	{ id: "cli", label: "CLI & Agents" },
	{ id: "provider", label: "Provider" },
	{ id: "diagnostics", label: "Diagnostics" },
];

function isSettingsSection(value: string | undefined): value is SettingsSection {
	return value != null && SETTINGS_SECTIONS.includes(value as SettingsSection);
}

/** Remounts on tab change so `motion-fade-up` plays for each section. */
function SettingsSectionMotion({
	sectionId,
	active,
	children,
}: {
	sectionId: SettingsSection;
	active: boolean;
	children: ReactNode;
}) {
	const reduceMotion = useReducedMotion();
	if (!active) return null;
	return (
		<div className={reduceMotion ? undefined : "motion-fade-up"} key={sectionId}>
			{children}
		</div>
	);
}

const IOS_TOOLCHAIN_QUERY_KEY = ["ios-toolchain"] as const;
const ANDROID_TOOLCHAIN_QUERY_KEY = ["android-toolchain"] as const;
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

function androidPathSourceLabel(kind: "sdk" | "java", source: AndroidPathSource): string {
	if (source === "env") return kind === "sdk" ? "from ANDROID_HOME" : "from JAVA_HOME";
	if (source === "android-studio") return "Android Studio JBR";
	if (source === "platform-default") return "Android Studio default";
	if (source === "java_home") return "from /usr/libexec/java_home";
	return "not detected";
}

function AndroidPathField({
	kind,
	label,
	description,
	value,
	placeholder,
	detectedPath,
	detectedSource,
	exists,
	overridden,
	onChange,
	onReset,
}: {
	kind: "sdk" | "java";
	label: string;
	description: string;
	value: string;
	placeholder: string;
	detectedPath: string | null;
	detectedSource: AndroidPathSource;
	exists: boolean;
	overridden: boolean;
	onChange: (next: string) => void;
	onReset: () => void;
}) {
	const savedMissing = value.trim().length > 0 && !exists;

	return (
		<SectionCard>
			<h3 className="text-subheading font-semibold text-on-surface">{label}</h3>
			<p className="mt-1 mb-3 text-body-md text-on-surface-variant">{description}</p>
			<TextField
				aria-label={label}
				className="w-full"
				isInvalid={savedMissing}
				onChange={onChange}
				value={value}
			>
				<Input
					className="h-12 w-full rounded-xl border border-outline-variant bg-surface-container px-3.5 font-mono text-body-sm shadow-none"
					placeholder={placeholder}
				/>
				{savedMissing ? (
					<FieldError>This folder was not found on disk.</FieldError>
				) : (
					<Description className="mt-1.5 text-helper text-on-surface-variant">
						System default: {detectedPath ?? "not found"} (
						{androidPathSourceLabel(kind, detectedSource)})
						{overridden ? " · using a custom path" : ""}
					</Description>
				)}
			</TextField>
			{overridden ? (
				<div className="mt-3">
					<Button onPress={onReset} size="sm" variant="tertiary">
						Use system default
					</Button>
				</div>
			) : null}
		</SectionCard>
	);
}

function draftPathOverride(draft: string, detected: string | null): string | null {
	const trimmed = draft.trim();
	if (!trimmed) return null;
	if (detected && trimmed === detected) return null;
	return trimmed;
}

function AndroidSettings({ enabled }: { enabled: boolean }) {
	const queryClient = useQueryClient();
	const [sdkRoot, setSdkRoot] = useState("");
	const [javaHome, setJavaHome] = useState("");
	const [saveError, setSaveError] = useState<string | null>(null);

	const toolchainQuery = useQuery({
		queryKey: ANDROID_TOOLCHAIN_QUERY_KEY,
		enabled,
		queryFn: async () => getDesktopRpc().request.getAndroidToolchain(),
		staleTime: 10_000,
	});

	useEffect(() => {
		if (!toolchainQuery.data) return;
		setSdkRoot(toolchainQuery.data.effective.sdkRoot ?? "");
		setJavaHome(toolchainQuery.data.effective.javaHome ?? "");
		setSaveError(null);
	}, [toolchainQuery.data]);

	const snapshot = toolchainQuery.data;
	const sdkOverrideDraft = draftPathOverride(sdkRoot, snapshot?.detected.sdkRoot.path ?? null);
	const javaOverrideDraft = draftPathOverride(javaHome, snapshot?.detected.javaHome.path ?? null);
	const dirty =
		snapshot != null &&
		(sdkOverrideDraft !== snapshot.preferences.sdkRoot ||
			javaOverrideDraft !== snapshot.preferences.javaHome);

	const saveMutation = useMutation({
		mutationFn: async () => {
			const next = await getDesktopRpc().request.setAndroidToolchainSelection({
				sdkRoot,
				javaHome,
			});
			await getDesktopRpc().request.restartLocalRunner();
			return next;
		},
		onSuccess: (next) => {
			queryClient.setQueryData<AndroidToolchainSnapshot>(ANDROID_TOOLCHAIN_QUERY_KEY, next);
			setSaveError(null);
		},
		onError: (error) => {
			setSaveError(error instanceof Error ? error.message : String(error));
		},
	});

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">
				Paths Appium uses for local Android tests. Detected from your system; override only if you
				need a different SDK or JDK.
			</p>

			{toolchainQuery.isLoading ? (
				<p className="text-body-md text-on-surface-variant">Detecting Android toolchain…</p>
			) : toolchainQuery.isError ? (
				<p className="text-body-md text-error">Could not detect Android SDK or Java paths.</p>
			) : snapshot ? (
				<>
					<AndroidPathField
						kind="sdk"
						detectedPath={snapshot.detected.sdkRoot.path}
						detectedSource={snapshot.detected.sdkRoot.source}
						description="Folder that contains platform-tools and emulator. Used as ANDROID_HOME and ANDROID_SDK_ROOT."
						exists={
							sdkRoot.trim() === (snapshot.effective.sdkRoot ?? "")
								? snapshot.effective.sdkRootExists
								: true
						}
						label="Android SDK"
						onChange={setSdkRoot}
						onReset={() => setSdkRoot(snapshot.detected.sdkRoot.path ?? "")}
						overridden={sdkOverrideDraft != null}
						placeholder={snapshot.detected.sdkRoot.path ?? "~/Library/Android/sdk"}
						value={sdkRoot}
					/>
					<AndroidPathField
						kind="java"
						detectedPath={snapshot.detected.javaHome.path}
						detectedSource={snapshot.detected.javaHome.source}
						description="JDK used to build and run UiAutomator2. Android Studio's bundled JBR is used when JAVA_HOME is unset."
						exists={
							javaHome.trim() === (snapshot.effective.javaHome ?? "")
								? snapshot.effective.javaHomeExists
								: true
						}
						label="JAVA_HOME"
						onChange={setJavaHome}
						onReset={() => setJavaHome(snapshot.detected.javaHome.path ?? "")}
						overridden={javaOverrideDraft != null}
						placeholder={snapshot.detected.javaHome.path ?? "/Library/Java/JavaVirtualMachines"}
						value={javaHome}
					/>
				</>
			) : null}

			<div className="flex flex-wrap items-center gap-3">
				<Button
					isDisabled={!enabled || !dirty || saveMutation.isPending || toolchainQuery.isLoading}
					onPress={() => saveMutation.mutate()}
					variant="primary"
				>
					{saveMutation.isPending ? "Saving…" : "Save and restart runner"}
				</Button>
				{dirty ? (
					<p className="text-body-sm text-on-surface-variant">
						Saving restarts the local runner so Appium picks up the new paths.
					</p>
				) : null}
			</div>
			{saveError ? <p className="text-body-sm text-error">{saveError}</p> : null}
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
		enabled: false,
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
		onSuccess: (result) => {
			queryClient.setQueryData(doctorQueryKey, result.report);
		},
		onError: (error) => showErrorToast(error, "Repair failed"),
	});

	const runDoctor = () => {
		if (!enabled || doctorQuery.isFetching || repairMutation.isPending) return;
		void doctorQuery.refetch();
	};

	const statusLabel = doctorQuery.isFetching
		? "Running checks…"
		: !doctorQuery.data
			? "Not run yet"
			: doctorQuery.data.ok
				? "All required checks passed"
				: "Some required checks need attention";

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
						<p
							className={[
								"mt-2 inline-flex rounded-full px-3 py-1 text-body-sm font-semibold",
								doctorQuery.isFetching || !doctorQuery.data
									? "bg-surface-container text-on-surface-variant"
									: doctorQuery.data.ok
										? "bg-secondary-container text-on-secondary-container"
										: (doctorQuery.data.checks.some((c) => c.status === "fail") ?? false)
											? "bg-error-container text-on-error-container"
											: "bg-amber-100 text-amber-900",
							].join(" ")}
						>
							{statusLabel}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						<Button
							isDisabled={!enabled || doctorQuery.isFetching || repairMutation.isPending}
							onPress={runDoctor}
							variant="secondary"
						>
							{doctorQuery.isFetching ? (
								<>
									<Spinner aria-label="Running diagnostics" color="current" size="sm" />
									{doctorQuery.data ? "Refreshing…" : "Running…"}
								</>
							) : doctorQuery.data ? (
								"Refresh"
							) : (
								"Run doctor"
							)}
						</Button>
						<Button
							isDisabled={
								repairMutation.isPending || !doctorQuery.data?.steps.some((step) => step.repair)
							}
							onPress={() => repairMutation.mutate()}
							variant="primary"
						>
							{repairMutation.isPending ? (
								<>
									<Spinner aria-label="Repairing" color="current" size="sm" />
									Repairing…
								</>
							) : (
								"Repair safe issues"
							)}
						</Button>
					</div>
				</div>

				{doctorQuery.isError ? (
					<p className="text-body-md text-error">
						Could not load doctor report. Is the local runner up?
					</p>
				) : !doctorQuery.data && !doctorQuery.isFetching ? (
					<p className="text-body-md text-on-surface-variant">
						Click Run doctor to generate a diagnostics report.
					</p>
				) : (
					<ul className="flex flex-col gap-2">
						{(doctorQuery.data?.checks ?? []).map((check) => (
							<li
								className={[
									"flex items-start justify-between gap-3 rounded-xl px-3.5 py-3",
									doctorStatusRowClass(check.status),
								].join(" ")}
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
								<DoctorStatusPill status={check.status} />
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
								className={[
									"flex items-start justify-between gap-3 rounded-xl px-3.5 py-3",
									doctorStepSeverityClass(step.severity),
								].join(" ")}
								key={`${step.title}-${step.detail}`}
							>
								<div className="min-w-0">
									<p className="text-body-md font-medium text-on-surface">{step.title}</p>
									<p className="mt-0.5 text-body-sm text-on-surface-variant">{step.detail}</p>
								</div>
								<DoctorSeverityPill severity={step.severity} />
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
	const initial = isSettingsSection(search.section) ? search.section : "ios";
	const [section, setSection] = useState<SettingsSection>(initial);

	useEffect(() => {
		if (isSettingsSection(search.section)) {
			setSection(search.section);
		}
	}, [search.section]);

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
			<header>
				<h1 className="text-headline-lg text-on-surface">Settings</h1>
			</header>

			<Tabs
				className="flex w-full flex-col gap-6"
				onSelectionChange={(key) => setSection(String(key) as SettingsSection)}
				selectedKey={section}
			>
				<SectionCard>
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
				</SectionCard>

				<Tabs.Panel className="pt-0 outline-none" id="ios">
					<SettingsSectionMotion active={section === "ios"} sectionId="ios">
						<IosSettings enabled={section === "ios"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="android">
					<SettingsSectionMotion active={section === "android"} sectionId="android">
						<AndroidSettings enabled={section === "android"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="cli">
					<SettingsSectionMotion active={section === "cli"} sectionId="cli">
						<CliSettings enabled={section === "cli"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="provider">
					<SettingsSectionMotion active={section === "provider"} sectionId="provider">
						<ProvidersSection enabled={section === "provider"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
				<Tabs.Panel className="pt-0 outline-none" id="diagnostics">
					<SettingsSectionMotion active={section === "diagnostics"} sectionId="diagnostics">
						<DiagnosticsSettings enabled={section === "diagnostics"} />
					</SettingsSectionMotion>
				</Tabs.Panel>
			</Tabs>
		</div>
	);
}
