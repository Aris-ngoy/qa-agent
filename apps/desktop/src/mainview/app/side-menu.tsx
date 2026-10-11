import { openExternalUrl } from "@/app/desktop-rpc";
import { AddApplicationModal } from "@/features/apps/add-application-modal";
import { useApps } from "@/features/apps/context";
import { useActiveRun } from "@/features/runs/active-run-context";
import { SidebarToggle } from "@/features/settings/sidebar-toggle";
import { useSidebarCollapsed } from "@/features/settings/use-sidebar-collapsed";
import { YoqaMark } from "@/features/splash/yoqa-mark";
import { Button, Dropdown, Label, Separator, Tooltip } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, type SVGProps, useMemo, useState } from "react";

const DOCS_URL = "https://yoqa.arisn.dev/docs/quickstart";

function NavIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4"
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="1.8"
			viewBox="0 0 24 24"
			{...props}
		/>
	);
}

function ChevronDownIcon(props: SVGProps<SVGSVGElement>) {
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
			<path d="M8 9l4-4 4 4M8 15l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	);
}

/** Names an icon-only control on hover and focus when the menu is collapsed to its rail. */
function RailTip({
	label,
	enabled,
	children,
}: { label: string; enabled: boolean; children: ReactNode }) {
	if (!enabled) return <>{children}</>;
	return (
		<Tooltip delay={200}>
			<Tooltip.Trigger className="block w-full">{children}</Tooltip.Trigger>
			<Tooltip.Content placement="right">{label}</Tooltip.Content>
		</Tooltip>
	);
}

function DocsIcon() {
	return (
		<NavIcon>
			<path d="M4 4h10l6 6v10H4z" />
			<path d="M14 4v6h6" />
		</NavIcon>
	);
}

type NavItem = {
	label: string;
	to?: string;
	icon: ReactNode;
	badge?: number;
};

const ADD_APP_KEY = "add-application";

/** Two letters for the collapsed workspace tile: first and last word, or the first two characters. */
function appInitials(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0 && word.toLowerCase() !== "and");
	const first = words[0];
	const last = words.length > 1 ? words[words.length - 1] : undefined;
	if (first && last) return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
	return (first?.slice(0, 2) ?? "Y").toUpperCase();
}

type SideMenuProps = {
	activePath?: string;
};

function isNavActive(itemTo: string | undefined, activePath: string): boolean {
	if (itemTo === undefined) return false;
	return (
		itemTo === activePath ||
		(itemTo === "/runs" && activePath.startsWith("/runs")) ||
		(itemTo !== "/" && itemTo !== "/runs" && activePath.startsWith(`${itemTo}/`))
	);
}

export function SideMenu({ activePath = "/" }: SideMenuProps) {
	const { apps, selectedApp, selectApp, addApp } = useApps();
	const { isRunLive } = useActiveRun();
	const [collapsed] = useSidebarCollapsed();
	const [modalOpen, setModalOpen] = useState(false);
	const [workspaceOpen, setWorkspaceOpen] = useState(false);
	const appLabel = selectedApp?.name ?? "Yoqa";

	const navItems = useMemo((): NavItem[] => {
		return [
			{
				label: "Test Cases",
				to: "/test-cases",
				icon: (
					<NavIcon>
						<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
					</NavIcon>
				),
			},
			{
				label: "Runs",
				to: "/runs",
				icon: (
					<NavIcon>
						<path d="M7 4.5v15l12-7.5z" />
					</NavIcon>
				),
				badge: isRunLive ? 1 : undefined,
			},
			{
				label: "Inspector",
				to: "/inspector",
				icon: (
					<NavIcon>
						<path d="M12 3l9 9-9 9-9-9z" />
						<circle cx="12" cy="12" r="2.5" />
					</NavIcon>
				),
			},
			{
				label: "Configuration",
				to: "/configuration",
				icon: (
					<NavIcon>
						<path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4" />
					</NavIcon>
				),
			},
			{
				label: "Settings",
				to: "/settings",
				icon: (
					<NavIcon>
						<path
							d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<path
							d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.2.6.7 1.1 1.5 1.1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</NavIcon>
				),
			},
		];
	}, [isRunLive]);

	return (
		<>
			<aside
				className={[
					"side-menu electrobun-webkit-app-region-no-drag flex h-full shrink-0 flex-col overflow-hidden rounded-[var(--radius)] border border-sidebar-fg/10 bg-sidebar py-3.5 text-sidebar-fg shadow-float",
					collapsed ? "w-[68px] items-center px-2" : "w-[244px] px-3",
				].join(" ")}
				id="side-menu"
			>
				{collapsed ? (
					<div className="mb-1 flex flex-col items-center gap-1">
						<YoqaMark className="size-8 shrink-0" />
						<SidebarToggle />
					</div>
				) : (
					<div className="flex h-9 items-center justify-between pr-0.5 pl-1.5">
						<div className="flex items-center gap-2.5">
							<YoqaMark className="size-8 shrink-0" />
							<span className="text-sm font-semibold tracking-tight">Yoqa</span>
						</div>
						<SidebarToggle />
					</div>
				)}

				<Dropdown isOpen={workspaceOpen} onOpenChange={setWorkspaceOpen}>
					<Button
						aria-expanded={workspaceOpen}
						aria-label={`Workspace: ${appLabel}. Switch application`}
						className={[
							"h-auto bg-transparent text-left text-sidebar-fg shadow-none",
							collapsed
								? "my-2.5 size-7 min-w-0 items-center justify-center rounded-[var(--radius)] p-0"
								: "my-3.5 w-full items-center gap-2.5 rounded-[var(--radius)] border border-sidebar-fg/15 bg-sidebar-fg/8 px-3 py-2.5",
						].join(" ")}
						variant="ghost"
					>
						{collapsed ? (
							<span
								aria-hidden="true"
								className="flex size-7 items-center justify-center rounded-[var(--radius)] bg-warning text-[11px] font-semibold text-on-warning-container"
								title={appLabel}
							>
								{appInitials(appLabel)}
							</span>
						) : (
							<>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="text-[11px] text-sidebar-muted">Workspace</span>
									<span className="truncate text-[13px] font-medium">{appLabel}</span>
								</span>
								<span className="text-sidebar-muted">
									<ChevronDownIcon />
								</span>
							</>
						)}
					</Button>
					<Dropdown.Popover className="w-64">
						<Dropdown.Menu
							onAction={(key) => {
								if (String(key) === ADD_APP_KEY) {
									setModalOpen(true);
									return;
								}
								selectApp(String(key));
							}}
							selectedKeys={selectedApp ? new Set([selectedApp.id]) : new Set()}
							selectionMode="single"
						>
							{apps.length > 0 ? (
								apps.map((app) => (
									<Dropdown.Item id={app.id} key={app.id} textValue={app.name}>
										<span
											aria-hidden="true"
											className="flex size-6 shrink-0 items-center justify-center rounded-[var(--radius)] bg-warning text-[10px] font-semibold text-on-warning-container"
										>
											{appInitials(app.name)}
										</span>
										<Label>{app.name}</Label>
									</Dropdown.Item>
								))
							) : (
								<Dropdown.Item id="empty" isDisabled textValue="No applications yet">
									<Label className="text-on-surface-variant">No applications yet.</Label>
								</Dropdown.Item>
							)}
							<Separator />
							<Dropdown.Item id={ADD_APP_KEY} textValue="Add application">
								<svg
									aria-hidden="true"
									className="size-4 text-primary"
									fill="none"
									stroke="currentColor"
									strokeWidth="1.75"
									viewBox="0 0 24 24"
								>
									<path d="M12 5v14M5 12h14" strokeLinecap="round" />
								</svg>
								<Label className="font-medium text-primary">Add application</Label>
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>

				<nav className="flex min-h-0 flex-1 flex-col gap-1">
					{navItems.map((item) => {
						const isActive = isNavActive(item.to, activePath);
						const className = [
							"flex items-center rounded-[var(--radius)] text-sm font-medium transition-colors duration-[var(--motion-fast)]",
							collapsed ? "mx-auto h-11 w-[52px] justify-center" : "h-11 gap-3 px-3.5",
							isActive
								? "bg-sidebar-fg/12 text-sidebar-fg"
								: "text-sidebar-muted hover:bg-sidebar-fg/10 hover:text-sidebar-fg",
							item.to ? "" : "cursor-default opacity-70",
						].join(" ");

						const content = (
							<>
								<span className={isActive ? "text-violet" : ""}>
									<span className="relative">
										{item.icon}
										{collapsed && item.badge !== undefined ? (
											<span
												aria-hidden="true"
												className="motion-scale-in absolute -top-0.5 -right-0.5 size-2 rounded-full bg-violet ring-2 ring-sidebar"
											/>
										) : null}
									</span>
								</span>
								<span className={collapsed ? "sr-only" : "flex-1"}>
									{item.label}
									{collapsed && item.badge !== undefined ? " (run in progress)" : ""}
								</span>
								{!collapsed && item.badge !== undefined ? (
									<span className="motion-scale-in flex size-5 items-center justify-center rounded-full bg-violet text-[10px] font-bold text-on-violet">
										{item.badge}
									</span>
								) : null}
							</>
						);

						if (item.to) {
							return (
								<RailTip enabled={collapsed} key={item.label} label={item.label}>
									<Link className={className} to={item.to}>
										{content}
									</Link>
								</RailTip>
							);
						}

						return (
							<span className={className} key={item.label}>
								{content}
							</span>
						);
					})}
				</nav>

				<div
					className={["mt-3 flex flex-col", collapsed ? "items-center gap-2" : "gap-2"].join(" ")}
				>
					<button
						aria-label="Add application"
						className="mb-1 flex size-[46px] items-center justify-center self-center rounded-full border border-dashed border-sidebar-fg/30 p-0"
						onClick={() => setModalOpen(true)}
						type="button"
					>
						<span className="flex size-[34px] items-center justify-center rounded-full bg-sidebar-fg text-sidebar">
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeWidth="2.4"
								viewBox="0 0 24 24"
							>
								<path d="M12 5v14M5 12h14" />
							</svg>
						</span>
					</button>

					<RailTip enabled={collapsed} label="Docs">
						<a
							aria-label="Docs"
							className={
								collapsed
									? "flex h-11 w-[52px] items-center justify-center rounded-[var(--radius)] text-sidebar-muted hover:bg-sidebar-fg/10 hover:text-sidebar-fg"
									: "flex items-center gap-2 px-2 text-[13px] text-sidebar-muted hover:text-sidebar-fg"
							}
							href={DOCS_URL}
							onClick={(event) => {
								event.preventDefault();
								void openExternalUrl(DOCS_URL);
							}}
							rel="noreferrer"
						>
							<DocsIcon />
							{collapsed ? <span className="sr-only">Docs</span> : "Docs"}
						</a>
					</RailTip>
					{collapsed ? (
						<span
							className="mb-1 block size-1.5 rounded-full bg-warning"
							title="Phase 1 · local only"
						/>
					) : (
						<span className="inline-flex items-center gap-1.5 px-2 font-mono text-[11px] text-sidebar-muted">
							<span className="block size-1.5 rounded-full bg-warning" />
							Phase 1 · local only
						</span>
					)}
				</div>
			</aside>

			<AddApplicationModal
				onAdd={(name) => {
					void addApp(name);
				}}
				onClose={() => setModalOpen(false)}
				open={modalOpen}
			/>
		</>
	);
}
