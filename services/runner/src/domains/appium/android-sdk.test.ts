import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	androidProcessEnv,
	androidSdkEnvPatch,
	defaultAndroidSdkRoot,
	defaultJavaHomeCandidates,
	pathWithAndroidSdk,
	resolveAndroidSdkRoot,
} from "./android-sdk";

describe("defaultAndroidSdkRoot", () => {
	test("uses Android Studio paths per platform", () => {
		expect(defaultAndroidSdkRoot("/Users/demo", "darwin")).toBe(
			join("/Users/demo", "Library", "Android", "sdk"),
		);
		expect(defaultAndroidSdkRoot("/home/demo", "linux")).toBe(join("/home/demo", "Android", "Sdk"));
		expect(defaultAndroidSdkRoot("/Users/demo", "win32", "/tmp/Local")).toBe(
			join("/tmp/Local", "Android", "Sdk"),
		);
	});
});

describe("resolveAndroidSdkRoot", () => {
	test("prefers ANDROID_HOME over ANDROID_SDK_ROOT and the default", () => {
		expect(
			resolveAndroidSdkRoot(
				{ ANDROID_HOME: "/custom/sdk", ANDROID_SDK_ROOT: "/other/sdk" },
				{ home: "/Users/demo", platform: "darwin" },
			),
		).toBe("/custom/sdk");
	});

	test("falls back to ANDROID_SDK_ROOT then the platform default", () => {
		expect(
			resolveAndroidSdkRoot(
				{ ANDROID_SDK_ROOT: "  /sdk-root  " },
				{ home: "/Users/demo", platform: "darwin" },
			),
		).toBe("/sdk-root");
		expect(resolveAndroidSdkRoot({}, { home: "/Users/demo", platform: "darwin" })).toBe(
			"/Users/demo/Library/Android/sdk",
		);
	});
});

describe("pathWithAndroidSdk", () => {
	test("prepends SDK bins onto a GUI-like PATH without duplicates", () => {
		const sdk = "/Users/demo/Library/Android/sdk";
		const next = pathWithAndroidSdk("/usr/bin:/bin", sdk);
		expect(next.split(":")).toEqual([
			`${sdk}/platform-tools`,
			`${sdk}/cmdline-tools/latest/bin`,
			`${sdk}/emulator`,
			"/usr/bin",
			"/bin",
		]);

		const again = pathWithAndroidSdk(next, sdk);
		expect(again.split(":").filter((p) => p === `${sdk}/platform-tools`)).toHaveLength(1);
	});
});

describe("androidSdkEnvPatch", () => {
	const darwin = {
		home: "/Users/demo",
		platform: "darwin" as const,
	};

	test("exports ANDROID_HOME when the default SDK exists and env is empty", () => {
		const sdk = "/Users/demo/Library/Android/sdk";
		expect(
			androidSdkEnvPatch(
				{ PATH: "/usr/bin:/bin" },
				{ ...darwin, pathExists: (path) => path === sdk },
			),
		).toEqual({
			ANDROID_HOME: sdk,
			ANDROID_SDK_ROOT: sdk,
			PATH: `${sdk}/platform-tools:${sdk}/cmdline-tools/latest/bin:${sdk}/emulator:/usr/bin:/bin`,
		});
	});

	test("does not invent ANDROID_HOME when the SDK directory is missing", () => {
		expect(
			androidSdkEnvPatch({ PATH: "/usr/bin" }, { ...darwin, pathExists: () => false }),
		).toEqual({});
	});

	test("keeps an existing ANDROID_HOME and still adds SDK bins to PATH", () => {
		const sdk = "/opt/android-sdk";
		const patch = androidSdkEnvPatch(
			{ ANDROID_HOME: sdk, PATH: "/usr/bin" },
			{ ...darwin, pathExists: (path) => path === sdk },
		);
		expect(patch.ANDROID_HOME).toBeUndefined();
		expect(patch.ANDROID_SDK_ROOT).toBeUndefined();
		expect(patch.PATH?.startsWith(`${sdk}/platform-tools:`)).toBe(true);
	});

	test("exports Android Studio JBR as JAVA_HOME when JAVA_HOME is unset", () => {
		const jbr = defaultJavaHomeCandidates("/Users/demo", "darwin")[0];
		expect(jbr).toBeDefined();
		const patch = androidSdkEnvPatch(
			{ PATH: "/usr/bin" },
			{ ...darwin, pathExists: (path) => path === jbr },
		);
		expect(patch.JAVA_HOME).toBe(jbr);
		expect(patch.ANDROID_HOME).toBeUndefined();
	});

	test("keeps an existing JAVA_HOME", () => {
		const jbr = defaultJavaHomeCandidates("/Users/demo", "darwin")[0];
		const patch = androidSdkEnvPatch(
			{ JAVA_HOME: "/opt/java", PATH: "/usr/bin" },
			{ ...darwin, pathExists: (path) => path === jbr },
		);
		expect(patch.JAVA_HOME).toBeUndefined();
	});
});

describe("androidProcessEnv", () => {
	test("merges SDK and JDK fallbacks onto a GUI-like env for Appium spawn", () => {
		const sdk = "/Users/demo/Library/Android/sdk";
		const jbr = defaultJavaHomeCandidates("/Users/demo", "darwin")[0];
		expect(jbr).toBeDefined();
		const env = androidProcessEnv(
			{ PATH: "/usr/bin", APPIUM_HOME: "/tmp/appium" },
			{
				home: "/Users/demo",
				platform: "darwin",
				pathExists: (path) => path === sdk || path === jbr,
			},
		);
		expect(env.ANDROID_HOME).toBe(sdk);
		expect(env.ANDROID_SDK_ROOT).toBe(sdk);
		expect(env.JAVA_HOME).toBe(jbr);
		expect(env.APPIUM_HOME).toBe("/tmp/appium");
		expect(env.PATH?.startsWith(`${sdk}/platform-tools:`)).toBe(true);
	});
});
