import {
	useSidebarCollapsed,
	useSidebarShortcut,
} from "@/features/settings/hooks/use-sidebar-collapsed";

/** Mount once at the app root to bind ⌘B to the side menu toggle. */
export function SidebarShortcut(): null {
	useSidebarShortcut();
	return null;
}

/** Side-menu button that collapses the menu to its icon rail and back. */
export function SidebarToggle() {
	const [collapsed, toggle] = useSidebarCollapsed();
	return (
		<button
			aria-controls="side-menu"
			aria-expanded={!collapsed}
			aria-label={collapsed ? "Expand side menu" : "Collapse side menu"}
			className="flex size-8 shrink-0 items-center justify-center rounded-lg text-sidebar-muted transition-colors duration-[var(--motion-fast)] hover:bg-sidebar-fg/10 hover:text-sidebar-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
			onClick={toggle}
			title={collapsed ? "Expand side menu (⌘B)" : "Collapse side menu (⌘B)"}
			type="button"
		>
			<svg
				aria-hidden="true"
				className="size-4"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
				viewBox="0 0 24 24"
			>
				<rect height="16" rx="3" width="18" x="3" y="4" />
				<path d="M9 4v16" />
			</svg>
		</button>
	);
}
