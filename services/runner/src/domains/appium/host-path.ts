import { homedir } from "node:os";
import { join } from "node:path";

/**
 * macOS GUI apps (Finder / Dock) get a minimal PATH without Homebrew / version managers.
 * Build a PATH that still finds npm/node and common agent CLIs (opencode, grok, etc.).
 */
export function pathWithHostTools(
	currentPath: string = process.env.PATH ?? "",
	home: string = homedir(),
): string {
	const extras = [
		"/opt/homebrew/bin",
		"/opt/homebrew/sbin",
		"/usr/local/bin",
		join(home, ".local", "bin"),
		join(home, ".bun", "bin"),
		join(home, ".opencode", "bin"),
		join(home, ".grok", "bin"),
		join(home, ".antigravity", "antigravity", "bin"),
	];
	const existing = currentPath.split(":").filter(Boolean);
	const prepend = extras.filter((dir) => !existing.includes(dir));
	return [...prepend, ...existing].join(":");
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
