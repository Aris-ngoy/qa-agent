import { applyTheme } from "@/features/settings/utils/apply-theme";
import {
	type ThemeMode,
	readThemeMode,
	writeThemeMode,
} from "@/features/settings/utils/ui-preferences";
import { useEffect, useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

let currentMode: ThemeMode = readThemeMode();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function setThemeMode(mode: ThemeMode): void {
	currentMode = mode;
	writeThemeMode(mode);
	for (const listener of listeners) listener();
}

/** Current theme mode; applies it to <html> and follows the OS live while on System. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
	const mode = useSyncExternalStore(subscribe, () => currentMode);

	useEffect(() => {
		const media = window.matchMedia(DARK_QUERY);
		const apply = () => applyTheme(document.documentElement, mode, media.matches);
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [mode]);

	return [mode, setThemeMode];
}

/** Mount once at the app root so the theme tracks the OS even when Settings is closed. */
export function ThemeSync(): null {
	useThemeMode();
	return null;
}
