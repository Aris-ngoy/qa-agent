import { describe, expect, test } from "bun:test";
import { appStartTarget, startTargetRequest } from "./app-start-target";

describe("appStartTarget", () => {
	const app = { iosBundleId: " com.example.app ", androidApplicationId: "com.example.android" };

	test("is the bundle id on iOS and the application id on Android", () => {
		expect(appStartTarget(app, "ios")).toBe("com.example.app");
		expect(appStartTarget(app, "android")).toBe("com.example.android");
	});

	test("is undefined when the platform's id is blank or there is no app", () => {
		expect(appStartTarget({ ...app, iosBundleId: "  " }, "ios")).toBeUndefined();
		expect(appStartTarget({ ...app, androidApplicationId: "" }, "android")).toBeUndefined();
		expect(appStartTarget(null, "ios")).toBeUndefined();
	});

	test("is undefined on web, where an App has no start target yet", () => {
		expect(appStartTarget(app, "web")).toBeUndefined();
	});
});

describe("startTargetRequest", () => {
	test("names the start target by the field its platform reads", () => {
		expect(startTargetRequest("ios", "com.example.app")).toEqual({ bundleId: "com.example.app" });
		expect(startTargetRequest("android", "com.example.android")).toEqual({
			appPackage: "com.example.android",
		});
	});

	test("names no field without a start target", () => {
		expect(startTargetRequest("ios", undefined)).toEqual({});
		expect(startTargetRequest("android", undefined)).toEqual({});
		expect(startTargetRequest("web", "https://example.com")).toEqual({});
	});
});
