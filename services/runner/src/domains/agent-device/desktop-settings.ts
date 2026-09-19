import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type DesktopIosSigning = {
	teamId?: string;
	bundleId?: string;
};

type CacheEntry = {
	mtimeMs: number;
	size: number;
	value: DesktopIosSigning;
};

let cache: CacheEntry | null = null;

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
 * Read iOS signing preferences from desktop Settings.
 * Returns `{}` when the file is missing — explicit `AGENT_DEVICE_IOS_*` env
 * always wins at the call site. Cached by file mtime so per-command reads
 * stay cheap; a torn read falls back to the last good value.
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
		const parsed = JSON.parse(raw) as {
			ios?: { teamId?: unknown; agentDeviceBundleId?: unknown };
		};
		const teamId = clean(parsed.ios?.teamId);
		const bundleId = clean(parsed.ios?.agentDeviceBundleId);
		const value: DesktopIosSigning = {
			...(teamId ? { teamId } : {}),
			...(bundleId ? { bundleId } : {}),
		};
		cache = { mtimeMs, size, value };
		return value;
	} catch {
		return cache?.value ?? {};
	}
}

/**
 * Overlay desktop Settings signing into an agent-device child env.
 * Never overrides explicit `AGENT_DEVICE_IOS_*` values (shell/CI).
 */
export async function withDesktopIosSigningEnv(
	env: Record<string, string>,
	file?: string,
): Promise<Record<string, string>> {
	if (env.AGENT_DEVICE_IOS_TEAM_ID?.trim() && env.AGENT_DEVICE_IOS_BUNDLE_ID?.trim()) {
		return env;
	}
	const signing = await readDesktopIosSigning(file);
	if (!env.AGENT_DEVICE_IOS_TEAM_ID?.trim() && signing.teamId) {
		env.AGENT_DEVICE_IOS_TEAM_ID = signing.teamId;
	}
	if (!env.AGENT_DEVICE_IOS_BUNDLE_ID?.trim() && signing.bundleId) {
		env.AGENT_DEVICE_IOS_BUNDLE_ID = signing.bundleId;
	}
	return env;
}
