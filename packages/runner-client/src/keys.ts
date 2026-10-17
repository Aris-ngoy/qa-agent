import { KEY_MODIFIERS, KEY_NAMES, type KeyModifier, type KeyName } from "./schemas";

function byName<T extends string>(names: readonly T[], raw: string, what: string): T {
	const match = names.find((name) => name.toLowerCase() === raw.trim().toLowerCase());
	if (!match) {
		throw new Error(`Unknown ${what} "${raw}" (expected one of: ${names.join(", ")})`);
	}
	return match;
}

/** A key named in any case (`enter`, `PageUp`), as the `key` Action spells it. */
export function parseKeyName(raw: string): KeyName {
	return byName(KEY_NAMES, raw, "key");
}

/** A comma-separated modifier list (`shift,control`), in any case. */
export function parseKeyModifiers(raw: string): KeyModifier[] {
	const names = raw
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	return [...new Set(names.map((name) => byName(KEY_MODIFIERS, name, "modifier")))];
}

/** `Shift+Tab`: the key with its modifiers, for reports and step labels. */
export function formatKeyChord(key: string, modifiers: readonly string[] = []): string {
	return [...modifiers, key].join("+");
}
