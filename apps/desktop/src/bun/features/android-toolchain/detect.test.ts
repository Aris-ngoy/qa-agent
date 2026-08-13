import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	defaultAndroidSdkRoot,
	detectJavaHome,
	detectSdkRoot,
	effectivePath,
	normalizePathOverride,
} from "./detect";

describe("defaultAndroidSdkRoot", () => {
	test("uses Android Studio defaults per platform", () => {
		expect(defaultAndroidSdkRoot("/Users/demo", "darwin")).toBe(
			join("/Users/demo", "Library", "Android", "sdk"),
		);
		expect(defaultAndroidSdkRoot("/home/demo", "linux")).toBe(join("/home/demo", "Android", "Sdk"));
	});
});

describe("normalizePathOverride", () => {
	test("stores null for empty or system-equal paths", () => {
		expect(normalizePathOverride("  ", "/sdk")).toBeNull();
		expect(normalizePathOverride("/sdk", "/sdk")).toBeNull();
		expect(normalizePathOverride("/custom/sdk", "/sdk")).toBe("/custom/sdk");
	});
});

describe("effectivePath", () => {
	test("prefers a custom override over the detected path", () => {
		expect(effectivePath("/custom", "/system")).toBe("/custom");
		expect(effectivePath(null, "/system")).toBe("/system");
		expect(effectivePath("  ", "/system")).toBe("/system");
	});
});

describe("detectSdkRoot", () => {
	test("prefers ANDROID_HOME, then the platform default", () => {
		expect(
			detectSdkRoot({
				env: { ANDROID_HOME: "/opt/sdk" },
				home: "/Users/demo",
				platform: "darwin",
				pathExists: () => true,
			}),
		).toEqual({ path: "/opt/sdk", source: "env", exists: true });

		const fallback = join("/Users/demo", "Library", "Android", "sdk");
		expect(
			detectSdkRoot({
				env: {},
				home: "/Users/demo",
				platform: "darwin",
				pathExists: (path) => path === fallback,
			}),
		).toEqual({ path: fallback, source: "platform-default", exists: true });
	});
});

describe("detectJavaHome", () => {
	test("prefers JAVA_HOME, then Android Studio JBR", () => {
		expect(
			detectJavaHome({
				env: { JAVA_HOME: "/opt/java" },
				home: "/Users/demo",
				platform: "darwin",
				pathExists: () => true,
			}),
		).toEqual({ path: "/opt/java", source: "env", exists: true });

		const jbr = join("/Applications", "Android Studio.app", "Contents", "jbr", "Contents", "Home");
		expect(
			detectJavaHome({
				env: {},
				home: "/Users/demo",
				platform: "darwin",
				pathExists: (path) => path === jbr,
			}),
		).toEqual({ path: jbr, source: "android-studio", exists: true });
	});
});
