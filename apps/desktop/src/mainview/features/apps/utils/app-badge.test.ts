import { describe, expect, test } from "bun:test";
import {
	APP_AVATAR_COLORS,
	appAvatarColors,
	appInitials,
	appPlatforms,
} from "@/features/apps/utils/app-badge";

const NO_PLATFORMS = { webUrl: "", androidApplicationId: "", iosBundleId: "", iosAppStoreId: "" };

describe("appInitials", () => {
	test("takes the first and last word", () => {
		expect(appInitials("Playzone Sandbox")).toBe("PS");
		expect(appInitials("Smoke and Settings")).toBe("SS");
	});

	test("takes the first two characters of a single word", () => {
		expect(appInitials("Youtube")).toBe("YO");
	});
});

describe("appAvatarColors", () => {
	test("gives every app a color from the palette", () => {
		const colors = appAvatarColors([{ id: "a" }, { id: "b" }]);
		expect(APP_AVATAR_COLORS).toContain(colors.get("a") as (typeof APP_AVATAR_COLORS)[number]);
		expect(APP_AVATAR_COLORS).toContain(colors.get("b") as (typeof APP_AVATAR_COLORS)[number]);
	});

	test("keeps an app's color stable when other apps are added after it", () => {
		const before = appAvatarColors([{ id: "app-1" }]);
		const after = appAvatarColors([{ id: "app-1" }, { id: "app-2" }, { id: "app-3" }]);
		expect(after.get("app-1")).toBe(before.get("app-1") as string);
	});

	test("gives apps distinct colors until the palette runs out", () => {
		const apps = APP_AVATAR_COLORS.map((_, index) => ({ id: `app-${index}` }));
		const colors = appAvatarColors(apps);
		expect(new Set(colors.values()).size).toBe(APP_AVATAR_COLORS.length);
	});

	test("still colors every app past the palette size", () => {
		const apps = Array.from({ length: APP_AVATAR_COLORS.length + 3 }, (_, index) => ({
			id: `app-${index}`,
		}));
		expect(appAvatarColors(apps).size).toBe(apps.length);
	});
});

describe("appPlatforms", () => {
	test("is web when the app has a URL, even with mobile ids", () => {
		expect(
			appPlatforms({
				...NO_PLATFORMS,
				webUrl: "https://example.com",
				androidApplicationId: "com.example",
			}),
		).toEqual(["web"]);
	});

	test("lists the mobile platforms the app has ids for", () => {
		expect(appPlatforms({ ...NO_PLATFORMS, androidApplicationId: "com.example" })).toEqual([
			"android",
		]);
		expect(appPlatforms({ ...NO_PLATFORMS, iosBundleId: "com.example" })).toEqual(["ios"]);
		expect(appPlatforms({ ...NO_PLATFORMS, iosAppStoreId: "123" })).toEqual(["ios"]);
		expect(
			appPlatforms({ ...NO_PLATFORMS, androidApplicationId: "a", iosBundleId: " b " }),
		).toEqual(["android", "ios"]);
	});

	test("is empty when nothing is configured or values are blank", () => {
		expect(appPlatforms(NO_PLATFORMS)).toEqual([]);
		expect(appPlatforms({ ...NO_PLATFORMS, webUrl: "   " })).toEqual([]);
	});
});
