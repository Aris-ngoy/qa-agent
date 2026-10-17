import { sidebarStore } from "@/features/settings/data/state/sidebar";
import { useValue } from "@legendapp/state/react";
import { useEffect } from "react";

/** True when the key event is ⌘B (Ctrl+B off macOS) with no other modifiers. */
function isToggleShortcut(event: KeyboardEvent): boolean {
	const mod = event.metaKey || event.ctrlKey;
	return mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "b";
}

export function useSidebarCollapsed(): [boolean, () => void] {
	return [useValue(sidebarStore.collapsed$), sidebarStore.toggle];
}

/** Mount once at the app root to bind ⌘B to the side menu toggle. */
export function useSidebarShortcut(): void {
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.repeat || event.isComposing || !isToggleShortcut(event)) return;
			event.preventDefault();
			sidebarStore.toggle();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
