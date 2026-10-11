import { openExternalUrl } from "@/app/desktop-rpc";
import { AddApplicationModal } from "@/features/apps/add-application-modal";
import { useApps } from "@/features/apps/context";
import { useActiveRun } from "@/features/runs/active-run-context";
import { useSidebarCollapsed } from "@/features/settings/use-sidebar-collapsed";
import { YoqaMark } from "@/features/splash/yoqa-mark";
import { Button, Dropdown, Label, Separator, Tooltip } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import {
	type ReactNode,
	type SVGProps,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";

const DOCS_URL = "https://yoqa.arisn.dev/docs/quickstart";

function NavIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
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
			<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
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

function BookIcon() {
	return (
		<NavIcon>
			<path
				d="M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 016.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
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
	const navRef = useRef<HTMLElement | null>(null);
	const itemRefs = useRef<Map<string, HTMLElement>>(new Map());
	const [pill, setPill] = useState<{ top: number; height: number } | null>(null);

	const navItems = useMemo((): NavItem[] => {
		return [
			{
				label: "Test Cases",
				to: "/test-cases",
				icon: (
					<NavIcon>
						<path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
					</NavIcon>
				),
			},
			{
				label: "Runs",
				to: "/runs",
				icon: (
					<NavIcon>
						<path d="M8 5.5v13l11-6.5L8 5.5Z" strokeLinejoin="round" />
					</NavIcon>
				),
				badge: isRunLive ? 1 : undefined,
			},
			{
				label: "Inspector",
				to: "/inspector",
				icon: (
					<NavIcon>
						<path
							d="M10.5 19.5 3 12l7.5-7.5M13.5 4.5 21 12l-7.5 7.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<circle cx="12" cy="12" r="2.25" />
					</NavIcon>
				),
			},
			{
				label: "Configuration",
				to: "/configuration",
				icon: (
					<NavIcon>
						<path d="M4 7h10M18 7h2M4 17h2M10 17h10" strokeLinecap="round" />
						<circle cx="16" cy="7" r="2.25" />
						<circle cx="8" cy="17" r="2.25" />
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

	const activeLabel = useMemo(() => {
		const active = navItems.find((item) => isNavActive(item.to, activePath));
		return active?.label ?? null;
	}, [navItems, activePath]);

	useLayoutEffect(() => {
		const nav = navRef.current;
		if (!nav || !activeLabel) {
			setPill(null);
			return;
		}
		const el = itemRefs.current.get(activeLabel);
		if (!el) {
			setPill(null);
			return;
		}
		const navBox = nav.getBoundingClientRect();
		const itemBox = el.getBoundingClientRect();
		setPill({
			top: itemBox.top - navBox.top,
			height: itemBox.height,
		});
	}, [activeLabel]);

	useEffect(() => {
		const onResize = () => {
			const nav = navRef.current;
			if (!nav || !activeLabel) return;
			const el = itemRefs.current.get(activeLabel);
			if (!el) return;
			const navBox = nav.getBoundingClientRect();
			const itemBox = el.getBoundingClientRect();
			setPill({
				top: itemBox.top - navBox.top,
				height: itemBox.height,
			});
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, [activeLabel]);

	return (
		<>
			<aside
				className={[
					"side-menu electrobun-webkit-app-region-no-drag flex h-full shrink-0 flex-col overflow-hidden rounded-[var(--radius-platform)] bg-sidebar py-5 text-sidebar-fg shadow-float",
					collapsed ? "w-16 px-2.5" : "w-sidebar px-3.5",
				].join(" ")}
				id="side-menu"
			>
				<div
					className={[
						"mb-7 flex flex-col gap-3",
						collapsed ? "items-center" : "items-start px-1",
					].join(" ")}
				>
					<YoqaMark className="size-8 shrink-0" />
					<Dropdown isOpen={workspaceOpen} onOpenChange={setWorkspaceOpen}>
						<Button
							aria-expanded={workspaceOpen}
							aria-label={`Workspace: ${appLabel}. Switch application`}
							className={[
								"h-auto rounded-xl bg-transparent text-left text-sidebar-fg transition-colors duration-[var(--motion-fast)] data-[hovered=true]:bg-sidebar-fg/10",
								collapsed
									? "size-11 min-w-0 items-center justify-center p-0"
									: "w-full flex-col items-stretch gap-0.5 px-2.5 py-2",
							].join(" ")}
							variant="ghost"
						>
							{collapsed ? (
								<span
									aria-hidden="true"
									className="flex size-8 items-center justify-center rounded-full bg-sidebar-fg text-subheading font-semibold text-sidebar"
								>
									{appLabel.slice(0, 1).toUpperCase()}
								</span>
							) : (
								<>
									<p className="text-body-sm text-sidebar-muted">Workspace</p>
									<span className="flex min-w-0 items-center gap-1.5">
										<span className="min-w-0 truncate text-subheading font-semibold tracking-tight text-sidebar-fg">
											{appLabel}
										</span>
										<span
											className={`text-sidebar-muted transition-transform duration-[var(--motion-fast)] ${workspaceOpen ? "rotate-180" : ""}`}
										>
											<ChevronDownIcon />
										</span>
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
												className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-helper font-semibold text-on-primary"
											>
												{app.name.slice(0, 1)}
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
				</div>

				<nav className="relative flex flex-1 flex-col gap-1" ref={navRef}>
					{pill ? (
						<span
							aria-hidden="true"
							className="nav-active-pill"
							style={{
								height: pill.height,
								transform: `translateY(${pill.top}px)`,
							}}
						/>
					) : null}
					{navItems.map((item) => {
						const isActive = isNavActive(item.to, activePath);
						const className = [
							"group relative z-[1] flex items-center rounded-full py-2.5 text-body-md transition-colors duration-[var(--motion-fast)]",
							collapsed ? "justify-center px-0" : "gap-2.5 px-3",
							isActive
								? "font-semibold text-sidebar-active"
								: "text-sidebar-muted hover:text-sidebar-fg",
							item.to ? "" : "cursor-default opacity-70",
						].join(" ");

						const setItemRef = (node: HTMLElement | null) => {
							if (node) {
								itemRefs.current.set(item.label, node);
							} else {
								itemRefs.current.delete(item.label);
							}
						};

						const content = (
							<>
								<span className={`relative ${isActive ? "text-sidebar-active" : ""}`}>
									{item.icon}
									{collapsed && item.badge !== undefined ? (
										<span
											aria-hidden="true"
											className="motion-scale-in absolute -right-0.5 -top-0.5 size-2 rounded-full bg-sidebar-fg ring-2 ring-sidebar"
										/>
									) : null}
								</span>
								<span className={collapsed ? "sr-only" : "flex-1"}>
									{item.label}
									{collapsed && item.badge !== undefined ? " (run in progress)" : ""}
								</span>
								{!collapsed && item.badge !== undefined ? (
									<span className="motion-scale-in flex size-5 items-center justify-center rounded-full bg-sidebar-fg text-[10px] font-bold text-sidebar">
										{item.badge}
									</span>
								) : null}
							</>
						);

						if (item.to) {
							return (
								<div key={item.label} className="relative" ref={setItemRef}>
									<RailTip enabled={collapsed} label={item.label}>
										<Link className={className} to={item.to}>
											{content}
										</Link>
									</RailTip>
								</div>
							);
						}

						return (
							<span key={item.label} className={className} ref={setItemRef}>
								{content}
							</span>
						);
					})}
				</nav>

				<div className="mt-6 flex flex-col gap-6">
					<button
						aria-label="Add application"
						className={`flex items-center justify-center self-center rounded-2xl ${collapsed ? "size-11" : "size-12"} border border-dashed border-sidebar-fg/25 transition-colors duration-[var(--motion-fast)] hover:scale-105 hover:border-sidebar-fg/50`}
						onClick={() => setModalOpen(true)}
						type="button"
					>
						<span className="flex size-8 items-center justify-center rounded-full bg-sidebar-fg text-sidebar shadow-card transition-transform duration-[var(--motion-fast)]">
							<svg
								aria-hidden="true"
								className="size-5"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								viewBox="0 0 24 24"
							>
								<path d="M12 5v14M5 12h14" strokeLinecap="round" />
							</svg>
						</span>
					</button>

					<div className={`flex flex-col gap-2 pt-2 ${collapsed ? "items-center" : "px-2"}`}>
						<RailTip enabled={collapsed} label="Docs">
							<a
								aria-label="Docs"
								className={
									collapsed
										? "flex justify-center rounded-full py-2 text-sidebar-muted hover:text-sidebar-fg"
										: "text-helper font-medium text-sidebar-muted underline-offset-2 hover:text-sidebar-fg hover:underline"
								}
								href={DOCS_URL}
								onClick={(event) => {
									event.preventDefault();
									void openExternalUrl(DOCS_URL);
								}}
								rel="noreferrer"
							>
								{collapsed ? <BookIcon /> : "Docs"}
							</a>
						</RailTip>
						{collapsed ? null : (
							<p className="text-helper text-sidebar-muted">Phase 1 · local only</p>
						)}
					</div>
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
