import type { CatalogApp, DevicePlatform, RetargetDeviceRequest } from "./schemas";

/**
 * What a Run or the Active Session starts for an App on `platform`: the bundle id on iOS,
 * the application id on Android. Undefined when the App has no id for that platform.
 */
export function appStartTarget(
	app: Pick<CatalogApp, "iosBundleId" | "androidApplicationId"> | null | undefined,
	platform: DevicePlatform,
): string | undefined {
	switch (platform) {
		case "ios":
			return app?.iosBundleId.trim() || undefined;
		case "android":
			return app?.androidApplicationId.trim() || undefined;
	}
}

/**
 * The connect or retarget request fields that name a start target on `platform`:
 * `bundleId` on iOS, `appPackage` on Android. Empty without a start target.
 */
export function startTargetRequest(
	platform: DevicePlatform,
	target: string | undefined,
): RetargetDeviceRequest {
	if (!target) return {};
	switch (platform) {
		case "ios":
			return { bundleId: target };
		case "android":
			return { appPackage: target };
	}
}
