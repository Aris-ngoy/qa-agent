import { readdir, stat, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Run evidence screenshots live here; files are named `shot_<ts>_<uuid>.png`. */
export const SCREENSHOT_DIR = join(homedir(), ".yoqa", "runs", "screenshots");

const SHOT_FILE_RE = /^shot_\d+_[0-9a-f-]+\.png$/i;

/** Default age: a week of evidence, then reclaim disk. `0` or less disables pruning. */
const DEFAULT_RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export type ScreenshotEntry = { name: string; mtimeMs: number };

/**
 * Which screenshots to delete. Age-based, so screenshots of runs in progress
 * (always fresh) are never touched. Only `shot_*.png` files are candidates.
 */
export function selectScreenshotsForPruning(
	entries: ScreenshotEntry[],
	options: { maxAgeMs: number; now: number },
): string[] {
	if (options.maxAgeMs <= 0) return [];
	const cutoff = options.now - options.maxAgeMs;
	return entries
		.filter((entry) => SHOT_FILE_RE.test(entry.name) && entry.mtimeMs < cutoff)
		.map((entry) => entry.name);
}

export function resolveScreenshotRetentionMs(
	env: Record<string, string | undefined> = process.env,
): number {
	const raw = env.YOQA_SCREENSHOT_RETENTION_DAYS;
	if (raw === undefined) return DEFAULT_RETENTION_DAYS * DAY_MS;
	const days = Number(raw);
	if (!Number.isFinite(days)) return DEFAULT_RETENTION_DAYS * DAY_MS;
	return days * DAY_MS;
}

/** Delete run screenshots older than the retention window. Best-effort; never throws. */
export async function pruneOldRunScreenshots(
	options: { dir?: string; maxAgeMs?: number; now?: number } = {},
): Promise<{ removed: number }> {
	const maxAgeMs = options.maxAgeMs ?? resolveScreenshotRetentionMs();
	if (maxAgeMs <= 0) return { removed: 0 };
	const dir = options.dir ?? SCREENSHOT_DIR;
	try {
		const names = (await readdir(dir)).filter((name) => SHOT_FILE_RE.test(name));
		const entries: ScreenshotEntry[] = [];
		for (const name of names) {
			const info = await stat(join(dir, name));
			entries.push({ name, mtimeMs: info.mtimeMs });
		}
		let removed = 0;
		for (const name of selectScreenshotsForPruning(entries, {
			maxAgeMs,
			now: options.now ?? Date.now(),
		})) {
			try {
				await unlink(join(dir, name));
				removed += 1;
			} catch {
				// Keep going — cleanup is best-effort.
			}
		}
		return { removed };
	} catch {
		return { removed: 0 };
	}
}
