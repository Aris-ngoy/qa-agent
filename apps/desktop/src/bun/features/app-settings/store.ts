import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AndroidToolchainPreferences } from "../../../shared/android-toolchain";
import type { IosToolchainPreferences } from "../../../shared/ios-toolchain";
import type { YoqaUpdateSettings } from "../../../shared/yoqa-update";

export const PREFS_DIR = join(homedir(), "Library/Application Support/yoqa");
export const PREFS_PATH = join(PREFS_DIR, "settings.json");

export type StoredSettings = {
	ios?: Partial<IosToolchainPreferences>;
	android?: Partial<AndroidToolchainPreferences>;
	yoqaUpdate?: Partial<YoqaUpdateSettings>;
	/** The Yoqa update the last session quit to apply; null once the next launch has read it. */
	yoqaUpdatePendingApply?: { version: string; fromHash: string } | null;
};

export async function readStoredSettings(): Promise<StoredSettings> {
	try {
		const raw = await readFile(PREFS_PATH, "utf8");
		return JSON.parse(raw) as StoredSettings;
	} catch {
		return {};
	}
}

export async function patchStoredSettings(patch: StoredSettings): Promise<StoredSettings> {
	await mkdir(PREFS_DIR, { recursive: true });
	const existing = await readStoredSettings();
	const next: StoredSettings = {
		...existing,
		...patch,
		ios: patch.ios ? { ...existing.ios, ...patch.ios } : existing.ios,
		android: patch.android ? { ...existing.android, ...patch.android } : existing.android,
		yoqaUpdate: patch.yoqaUpdate
			? { ...existing.yoqaUpdate, ...patch.yoqaUpdate }
			: existing.yoqaUpdate,
	};
	await writeFile(PREFS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	return next;
}
