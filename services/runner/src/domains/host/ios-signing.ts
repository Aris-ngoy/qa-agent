import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type DesktopIosSigning = {
	teamId?: string;
};

let cache: { mtimeMs: number; size: number; value: DesktopIosSigning } | null = null;

/** Test-only: drop the cached settings read. */
export function resetDesktopIosSigningCacheForTests(): void {
	cache = null;
}

/** Location of the desktop app Settings file (`bun/features/app-settings/store.ts`). */
export function desktopSettingsPath(home: string = homedir()): string {
	return join(home, "Library", "Application Support", "yoqa", "settings.json");
}

function clean(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Read iOS signing preferences from desktop Settings. Returns `{}` when the
 * file is missing. Explicit `ARGENT_IOS_TEAM_ID` env always wins at the call
 * site. Cached by file mtime so per-command reads stay cheap.
 */
export async function readDesktopIosSigning(
	file: string = desktopSettingsPath(),
): Promise<DesktopIosSigning> {
	let mtimeMs = 0;
	let size = 0;
	try {
		const st = await stat(file);
		mtimeMs = st.mtimeMs;
		size = st.size;
	} catch {
		return {};
	}
	if (cache && cache.mtimeMs === mtimeMs && cache.size === size) {
		return cache.value;
	}
	try {
		const raw = await readFile(file, "utf8");
		const parsed = JSON.parse(raw) as { ios?: { teamId?: unknown } };
		const teamId = clean(parsed.ios?.teamId);
		const value: DesktopIosSigning = { ...(teamId ? { teamId } : {}) };
		cache = { mtimeMs, size, value };
		return value;
	} catch {
		return cache?.value ?? {};
	}
}

/**
 * Overlay desktop Settings signing into an Argent child env. Never overrides
 * an explicit `ARGENT_IOS_TEAM_ID` value (shell/CI).
 */
export async function withArgentIosSigningEnv(
	env: Record<string, string>,
	file?: string,
): Promise<Record<string, string>> {
	if (env.ARGENT_IOS_TEAM_ID?.trim()) return env;
	const signing = await readDesktopIosSigning(file);
	if (signing.teamId) env.ARGENT_IOS_TEAM_ID = signing.teamId;
	return env;
}
