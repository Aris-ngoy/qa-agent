import { SectionCard } from "@/features/settings/components/section-card";
import {
	useCliActions,
	useCliEnvironment,
} from "@/features/settings/hooks/usequery/use-toolchains";
import { Button } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type { SVGProps } from "react";

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

export function CliSettings({ enabled }: { enabled: boolean }) {
	const errors$ = useObservable({
		cli: null as string | null,
		skill: null as string | null,
		open: null as string | null,
	});
	const cliError = useValue(errors$.cli);
	const skillError = useValue(errors$.skill);
	const openError = useValue(errors$.open);

	const envQuery = useCliEnvironment(enabled);
	const snapshot = envQuery.data;
	const { installCliMutation, installSkillMutation, openFolderMutation } = useCliActions({
		cli: (error) => errors$.cli.set(error),
		skill: (error) => errors$.skill.set(error),
		open: (error) => errors$.open.set(error),
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
