import { homedir } from "node:os";
import { posix, win32 } from "node:path";

/** PATH separator for `platform` (`;` on Windows, `:` elsewhere). */
export function pathDelimiter(platform: NodeJS.Platform = process.platform): string {
	return platform === "win32" ? win32.delimiter : posix.delimiter;
}

/** Prepend `entries` onto a PATH string, skipping dirs it already has. */
export function prependPathEntries(
	currentPath: string,
	entries: string[],
	platform: NodeJS.Platform = process.platform,
): string {
	const delimiter = pathDelimiter(platform);
	const existing = currentPath.split(delimiter).filter(Boolean);
	const prepend = entries.filter((dir) => !existing.includes(dir));
	return [...prepend, ...existing].join(delimiter);
}

/**
 * macOS GUI apps (Finder / Dock) get a minimal PATH without Homebrew / version managers.
 * Build a PATH that still finds npm/node and common agent CLIs (opencode, grok, etc.).
 * On Windows only the per-user install dirs apply; Homebrew paths are skipped.
 */
export function pathWithHostTools(
	currentPath: string = process.env.PATH ?? "",
	home: string = homedir(),
	platform: NodeJS.Platform = process.platform,
): string {
	const { join } = platform === "win32" ? win32 : posix;
	const extras = [
		...(platform === "win32" ? [] : ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"]),
		join(home, ".local", "bin"),
		join(home, ".bun", "bin"),
		join(home, ".opencode", "bin"),
		join(home, ".grok", "bin"),
		join(home, ".antigravity", "antigravity", "bin"),
	];
	return prependPathEntries(currentPath, extras, platform);
}

let hostToolPathReady = false;

/** Idempotent — mutates `process.env.PATH` once per process. */
export function ensureHostToolPath(): void {
	if (hostToolPathReady) return;
	hostToolPathReady = true;
	process.env.PATH = pathWithHostTools();
}

/** Test-only: allow re-applying after PATH is reset. */
export function resetHostToolPathForTests(): void {
	hostToolPathReady = false;
}
