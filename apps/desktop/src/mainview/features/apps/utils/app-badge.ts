import type { Application } from "@/features/apps/data/api/apps";

/** Two letters for an app's avatar: first and last word, or the first two characters. */
export function appInitials(name: string): string {
	const words = name
		.trim()
		.split(/\s+/)
		.filter((word) => word.length > 0 && word.toLowerCase() !== "and");
	const first = words[0];
	const last = words.length > 1 ? words[words.length - 1] : undefined;
	if (first && last) return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
	return (first?.slice(0, 2) ?? "Y").toUpperCase();
}

/**
 * Avatar backgrounds, each dark enough for `text-on-avatar` (white) in both themes. Full class
 * names so Tailwind keeps them.
 */
export const APP_AVATAR_COLORS = [
	"bg-blue-600",
	"bg-emerald-700",
	"bg-violet-600",
	"bg-orange-700",
	"bg-cyan-700",
	"bg-rose-600",
	"bg-indigo-600",
	"bg-teal-700",
	"bg-fuchsia-700",
	"bg-amber-700",
	"bg-sky-700",
	"bg-red-600",
	"bg-purple-600",
	"bg-pink-700",
] as const;

/** Fallback avatar color when an app is not in the list the colors were assigned from. */
export const DEFAULT_APP_AVATAR_COLOR = APP_AVATAR_COLORS[0];

/** FNV-1a: a small stable hash, so an app keeps its color across reloads. */
function hashId(id: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < id.length; index++) {
		hash ^= id.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/**
 * Each app's avatar color, keyed by id. An app starts from the color its id hashes to and moves
 * to the next free one on a clash, so apps in the list never share a color until the palette
 * runs out.
 */
export function appAvatarColors(apps: readonly Pick<Application, "id">[]): Map<string, string> {
	const colors = new Map<string, string>();
	let used = new Set<number>();
	for (const app of apps) {
		if (used.size === APP_AVATAR_COLORS.length) used = new Set();
		let slot = hashId(app.id) % APP_AVATAR_COLORS.length;
		while (used.has(slot)) slot = (slot + 1) % APP_AVATAR_COLORS.length;
		used.add(slot);
		colors.set(app.id, APP_AVATAR_COLORS[slot] ?? DEFAULT_APP_AVATAR_COLOR);
	}
	return colors;
}

export type AppPlatform = "web" | "android" | "ios";

export const APP_PLATFORM_LABELS: Record<AppPlatform, string> = {
	web: "Web",
	android: "Android",
	ios: "iOS",
};

/**
 * What an app runs on, for its badge: web when it has a URL, otherwise the mobile platforms it
 * has an identifier for.
 */
export function appPlatforms(
	app: Pick<Application, "webUrl" | "androidApplicationId" | "iosBundleId" | "iosAppStoreId">,
): AppPlatform[] {
	if (app.webUrl.trim()) return ["web"];
	const platforms: AppPlatform[] = [];
	if (app.androidApplicationId.trim()) platforms.push("android");
	if (app.iosBundleId.trim() || app.iosAppStoreId.trim()) platforms.push("ios");
	return platforms;
}
