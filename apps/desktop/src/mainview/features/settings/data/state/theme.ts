import {
	type ThemeMode,
	readThemeMode,
	resolveTheme,
	writeThemeMode,
} from "@/features/settings/utils/ui-preferences";
import { observable } from "@legendapp/state";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function darkQuery(): MediaQueryList | null {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
	return window.matchMedia(DARK_QUERY);
}

/** The theme the user picked: Light, Dark, or System. */
export const themeMode$ = observable<ThemeMode>(readThemeMode());

/** The OS dark-mode setting, followed live. */
export const osPrefersDark$ = observable(darkQuery()?.matches ?? false);
darkQuery()?.addEventListener("change", (event) => osPrefersDark$.set(event.matches));

/** The theme to render: an explicit mode wins, System follows the OS. */
export const effectiveTheme$ = observable(() =>
	resolveTheme(themeMode$.get(), osPrefersDark$.get()),
);

export function setThemeMode(mode: ThemeMode): void {
	themeMode$.set(mode);
	writeThemeMode(mode);
}
