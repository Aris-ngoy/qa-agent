/** What a keydown carries that decides whether it is the Reload (a page) shortcut. */
type ShortcutKey = {
	key: string;
	metaKey: boolean;
	ctrlKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
};

/**
 * F5 or ⌘R, as a browser's reload. Shift+F5 and ⇧⌘R are a hard reload elsewhere, which
 * Reload (a page) is not, so they do not count.
 */
export function isReloadShortcut(event: ShortcutKey): boolean {
	if (event.altKey || event.shiftKey || event.ctrlKey) return false;
	if (event.key === "F5") return !event.metaKey;
	return event.metaKey && event.key.toLowerCase() === "r";
}

/** Where a key is typing: a field, a select, or an editable region such as the script editor. */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!target || typeof (target as HTMLElement).tagName !== "string") return false;
	const element = target as HTMLElement;
	if (element.isContentEditable) return true;
	return ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}
