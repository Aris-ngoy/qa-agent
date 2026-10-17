import { osPrefersDark$, setThemeMode, themeMode$ } from "@/features/settings/data/state/theme";
import { applyTheme } from "@/features/settings/utils/apply-theme";
import type { ThemeMode } from "@/features/settings/utils/ui-preferences";
import { useObserveEffect, useValue } from "@legendapp/state/react";

/** Current theme mode and its setter. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
	return [useValue(themeMode$), setThemeMode];
}

/** Stamp the theme on <html> now and whenever the mode or the OS setting changes. */
export function useThemeSync(): void {
	useObserveEffect(() => {
		applyTheme(document.documentElement, themeMode$.get(), osPrefersDark$.get());
	});
}
