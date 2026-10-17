import { describe, expect, test } from "bun:test";
import { appStartTarget, startTargetRequest } from "./app-start-target";

describe("appStartTarget", () => {
	const app = {
		iosBundleId: " com.example.app ",
		androidApplicationId: "com.example.android",
		webUrl: " https://app.example.com/ ",
	};

	test("is the bundle id on iOS, the application id on Android and the Web URL on web", () => {
		expect(appStartTarget(app, "ios")).toBe("com.example.app");
		expect(appStartTarget(app, "android")).toBe("com.example.android");
		expect(appStartTarget(app, "web")).toBe("https://app.example.com/");
	});

	test("is undefined when the platform's id is blank or there is no app", () => {
		expect(appStartTarget({ ...app, iosBundleId: "  " }, "ios")).toBeUndefined();
		expect(appStartTarget({ ...app, androidApplicationId: "" }, "android")).toBeUndefined();
		expect(appStartTarget({ ...app, webUrl: "" }, "web")).toBeUndefined();
		expect(appStartTarget(null, "ios")).toBeUndefined();
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
