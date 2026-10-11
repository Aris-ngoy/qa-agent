import { useEffect, useSyncExternalStore } from "react";
import { sidebarStore } from "./sidebar-store";

/** True when the key event is ⌘B (Ctrl+B off macOS) with no other modifiers. */
function isToggleShortcut(event: KeyboardEvent): boolean {
	const mod = event.metaKey || event.ctrlKey;
	return mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b";
}

export function useSidebarCollapsed(): [boolean, () => void] {
	const collapsed = useSyncExternalStore(sidebarStore.subscribe, sidebarStore.get);
	return [collapsed, sidebarStore.toggle];
}

/** Mount once at the app root to bind ⌘B to the side menu toggle. */
export function useSidebarShortcut(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!isToggleShortcut(event)) return;
			event.preventDefault();
			sidebarStore.toggle();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
