import { Button } from "@heroui/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode, SVGProps } from "react";
import { WorkspaceHeader } from "./workspace-header";

function NavIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-[18px]"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		/>
	);
}

type NavItem = {
	label: string;
	to?: string;
	icon: ReactNode;
};

const navItems: NavItem[] = [
	{
		label: "Status",
		to: "/status",
		icon: (
			<NavIcon>
				<path
					d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
					strokeLinecap="round"
				/>
				<circle cx="12" cy="12" r="3.5" />
			</NavIcon>
		),
	},
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
		label: "Runs",
		icon: (
			<NavIcon>
				<path d="M8 5.5v13l11-6.5L8 5.5Z" strokeLinejoin="round" />
			</NavIcon>
		),
	},
	{
		label: "Integrations",
		icon: (
			<NavIcon>
				<path
					d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L10.5 5.5"
					strokeLinecap="round"
				/>
				<path
					d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 1 0 7.07 7.07L13.5 18.5"
					strokeLinecap="round"
				/>
			</NavIcon>
		),
	},
	{
		label: "Configuration",
		icon: (
			<NavIcon>
				<circle cx="12" cy="12" r="3" />
				<path
					d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
					strokeLinecap="round"
				/>
			</NavIcon>
		),
	},
];

type AppShellProps = {
	children: ReactNode;
	activePath?: string;
};

export function AppShell({ children, activePath = "/" }: AppShellProps) {
	return (
		<div className="flex min-h-full flex-col bg-background text-on-surface">
			<WorkspaceHeader />

			<div className="flex min-h-0 flex-1">
				<aside className="sticky top-14 flex h-[calc(100vh-3.5rem)] w-sidebar shrink-0 flex-col border-r border-outline-variant bg-surface-container-low py-6">
					<div className="mb-6 px-6">
						<Link className="block" to="/">
							<p className="text-headline-md tracking-tight text-primary">qa-agent</p>
							<p className="text-helper text-on-surface-variant">Local QA host</p>
						</Link>
					</div>

					<nav className="flex flex-1 flex-col gap-1 px-4">
						{navItems.map((item) => {
							const isActive =
								item.to !== undefined &&
								(item.to === activePath ||
									(item.to !== "/" && activePath.startsWith(`${item.to}/`)));
							const className = [
								"flex items-center gap-2 rounded px-nav-x py-nav-y text-body-md transition-colors duration-150",
								isActive
									? "bg-sidebar-active font-semibold text-primary"
									: "text-on-surface-variant hover:bg-hover-surface",
								item.to ? "" : "cursor-default opacity-60",
							].join(" ");

							if (item.to) {
								return (
									<Link key={item.label} className={className} to={item.to}>
										{item.icon}
										<span>{item.label}</span>
									</Link>
								);
							}

							return (
								<span key={item.label} className={className}>
									{item.icon}
									<span>{item.label}</span>
								</span>
							);
						})}
					</nav>

					<div className="mt-auto space-y-stack-sm border-t border-outline-variant px-4 pt-stack-md">
						<Button className="w-full bg-secondary text-on-secondary" isDisabled>
							<svg
								aria-hidden="true"
								className="size-[18px]"
								fill="currentColor"
								viewBox="0 0 24 24"
							>
								<path d="M8 5.5v13l11-6.5L8 5.5Z" />
							</svg>
							Run Tests
						</Button>
						<p className="px-3 py-2 text-helper text-on-surface-variant">Phase 1 · local only</p>
					</div>
				</aside>

				<main className="min-w-0 flex-1 bg-surface-container-lowest px-container py-gutter">
					{children}
				</main>
			</div>
		</div>
	);
}
