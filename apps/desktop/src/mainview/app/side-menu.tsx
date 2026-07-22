import { AddApplicationModal } from "@/features/apps/add-application-modal";
import { useApps } from "@/features/apps/context";
import { SettingsModal } from "@/features/settings/settings-modal";
import { Button, Dropdown, Label, Separator } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, type SVGProps, useState } from "react";

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

type NavItem = {
	label: string;
	to?: string;
	icon: ReactNode;
	badge?: number;
};

const navItems: NavItem[] = [
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
		icon: (
			<NavIcon>
				<path d="M8 5.5v13l11-6.5L8 5.5Z" strokeLinejoin="round" />
			</NavIcon>
		),
		badge: 3,
	},
	{
		label: "Builds",
		icon: (
			<NavIcon>
				<path
					d="M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L4 17v3h3l4.3-4.3a4.5 4.5 0 0 0 6.4-6.4Z"
					strokeLinejoin="round"
				/>
			</NavIcon>
		),
	},
	{
		label: "Configuration",
		to: "/configuration",
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

const ADD_APP_KEY = "add-application";

type SideMenuProps = {
	activePath?: string;
};

export function SideMenu({ activePath = "/" }: SideMenuProps) {
	const { apps, selectedApp, selectApp, addApp } = useApps();
	const [modalOpen, setModalOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const appLabel = selectedApp?.name ?? "YoQA";
	const appInitial = appLabel.slice(0, 1).toUpperCase();

	return (
		<>
			<aside className="electrobun-webkit-app-region-no-drag flex h-full w-sidebar shrink-0 flex-col rounded-[var(--radius-platform)] bg-sidebar px-5 py-7 text-sidebar-fg shadow-float">
				<div className="mb-10 flex flex-col items-start gap-3 px-1">
					<Dropdown>
						<Button
							className="h-auto gap-0 bg-transparent p-0 text-sidebar-fg data-[hovered=true]:bg-transparent"
							variant="ghost"
						>
							<span className="flex size-14 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-card-lavender to-card-rose text-xl font-bold text-primary shadow-card">
								{appInitial}
							</span>
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
					<div>
						<p className="text-body-sm text-sidebar-muted">Workspace</p>
						<p className="text-subheading font-semibold tracking-tight text-sidebar-fg">
							{appLabel}
						</p>
					</div>
				</div>

				<nav className="flex flex-1 flex-col gap-1">
					{navItems.map((item) => {
						const isActive =
							item.to !== undefined &&
							(item.to === activePath || (item.to !== "/" && activePath.startsWith(`${item.to}/`)));
						const className = [
							"group relative flex items-center gap-3 rounded-full px-4 py-3 text-body-md transition-colors duration-150",
							isActive
								? "font-semibold text-sidebar-active"
								: "text-sidebar-muted hover:text-sidebar-fg",
							item.to ? "" : "cursor-default opacity-70",
						].join(" ");

						const content = (
							<>
								<span className={isActive ? "text-sidebar-active" : ""}>{item.icon}</span>
								<span className="flex-1">{item.label}</span>
								{item.badge !== undefined ? (
									<span className="flex size-5 items-center justify-center rounded-full bg-white text-[10px] font-bold text-primary">
										{item.badge}
									</span>
								) : null}
							</>
						);

						if (item.to) {
							return (
								<Link key={item.label} className={className} to={item.to}>
									{content}
								</Link>
							);
						}

						return (
							<span key={item.label} className={className}>
								{content}
							</span>
						);
					})}
				</nav>

				<div className="mt-6 flex flex-col gap-6">
					<button
						aria-label="Add application"
						className="flex size-16 items-center justify-center self-center rounded-2xl border border-dashed border-white/25 transition-colors hover:border-white/50"
						onClick={() => setModalOpen(true)}
						type="button"
					>
						<span className="flex size-10 items-center justify-center rounded-full bg-white text-primary shadow-card">
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

					<div className="flex flex-col gap-1">
						<button
							className="group relative flex items-center gap-3 rounded-full px-4 py-3 text-body-md text-sidebar-muted transition-colors duration-150 hover:text-sidebar-fg"
							onClick={() => setSettingsOpen(true)}
							type="button"
						>
							<span>
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
							</span>
							<span className="flex-1 text-left">Settings</span>
						</button>
						<p className="px-4 pt-2 text-helper text-sidebar-muted">Phase 1 · local only</p>
					</div>
				</div>
			</aside>

			<AddApplicationModal
				onAdd={(name) => {
					addApp(name);
				}}
				onClose={() => setModalOpen(false)}
				open={modalOpen}
			/>
			<SettingsModal onClose={() => setSettingsOpen(false)} open={settingsOpen} />
		</>
	);
}
