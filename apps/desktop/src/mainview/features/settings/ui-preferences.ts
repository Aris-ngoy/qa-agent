export type ThemeMode = "light" | "dark" | "system";
export type EffectiveTheme = "light" | "dark";

type PreferencesStorage = Pick<Storage, "getItem" | "setItem">;

const THEME_MODE_KEY = "yoqa.themeMode";
const SIDEBAR_COLLAPSED_KEY = "yoqa.sidebarCollapsed";

function defaultStorage(): PreferencesStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

function readItem(storage: PreferencesStorage | null, key: string): string | null {
	try {
		return storage?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function writeItem(storage: PreferencesStorage | null, key: string, value: string): void {
	try {
		storage?.setItem(key, value);
	} catch {
		// ignore storage failures in restricted webviews
	}
}

export function readThemeMode(storage: PreferencesStorage | null = defaultStorage()): ThemeMode {
	const raw = readItem(storage, THEME_MODE_KEY);
	return raw === "light" || raw === "dark" ? raw : "system";
}

export function writeThemeMode(
	mode: ThemeMode,
	storage: PreferencesStorage | null = defaultStorage(),
): void {
	writeItem(storage, THEME_MODE_KEY, mode);
}

export function readSidebarCollapsed(
	storage: PreferencesStorage | null = defaultStorage(),
): boolean {
	return readItem(storage, SIDEBAR_COLLAPSED_KEY) === "true";
}

export function writeSidebarCollapsed(
	collapsed: boolean,
	storage: PreferencesStorage | null = defaultStorage(),
): void {
	writeItem(storage, SIDEBAR_COLLAPSED_KEY, String(collapsed));
}

/** The theme to render: an explicit mode wins, System follows the OS dark-mode setting. */
export function resolveTheme(mode: ThemeMode, osPrefersDark: boolean): EffectiveTheme {
	if (mode === "system") return osPrefersDark ? "dark" : "light";
	return mode;
}
