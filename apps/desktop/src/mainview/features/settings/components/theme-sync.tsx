import { useThemeSync } from "@/features/settings/hooks/use-theme-mode";

/** Mount once at the app root so the theme tracks the OS even when Settings is closed. */
export function ThemeSync(): null {
	useThemeSync();
	return null;
}
