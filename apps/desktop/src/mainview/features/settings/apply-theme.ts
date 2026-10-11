import { type EffectiveTheme, type ThemeMode, resolveTheme } from "./ui-preferences";

type ThemeRoot = {
	dataset: Record<string, string | undefined>;
	style: { colorScheme: string };
};

/** Stamps the effective theme on the root so tokens and native controls switch together. */
export function applyTheme(
	root: ThemeRoot,
	mode: ThemeMode,
	osPrefersDark: boolean,
): EffectiveTheme {
	const theme = resolveTheme(mode, osPrefersDark);
	root.dataset.theme = theme;
	root.style.colorScheme = theme;
	return theme;
}
