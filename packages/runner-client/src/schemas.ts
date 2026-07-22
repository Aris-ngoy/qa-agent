import { z } from "zod";

export const healthResponseSchema = z.object({
	ok: z.literal(true),
	service: z.literal("yoqa-runner"),
	version: z.string(),
	uptimeMs: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const devicePlatformSchema = z.union([z.literal("ios"), z.literal("android")]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

export const deviceKindSchema = z.union([
	z.literal("physical"),
	z.literal("simulator"),
	z.literal("emulator"),
]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

export const deviceSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	/** User-facing device name (physical only), e.g. "Aristote's iPhone" */
	owner: z.string().optional(),
	osVersion: z.string().min(1),
	platform: devicePlatformSchema,
	kind: deviceKindSchema,
	/** Connection / boot state from the host tooling */
	state: z.string().optional(),
	model: z.string().optional(),
});

export type Device = z.infer<typeof deviceSchema>;

export const listDevicesResponseSchema = z.object({
	platform: devicePlatformSchema,
	devices: z.array(deviceSchema),
});

export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

export const appiumDriverSchema = z.union([z.literal("xcuitest"), z.literal("uiautomator2")]);
export type AppiumDriver = z.infer<typeof appiumDriverSchema>;

export const setupPlatformRequestSchema = z.object({
	platform: devicePlatformSchema,
});

export type SetupPlatformRequest = z.infer<typeof setupPlatformRequestSchema>;

export const setupPlatformResponseSchema = z.object({
	ok: z.literal(true),
	platform: devicePlatformSchema,
	driver: appiumDriverSchema,
	appiumVersion: z.string().min(1),
	driverVersion: z.string().optional(),
	alreadyInstalled: z.boolean(),
	message: z.string().min(1),
});

export type SetupPlatformResponse = z.infer<typeof setupPlatformResponseSchema>;

export const setupPlatformErrorSchema = z.object({
	error: z.string().min(1),
	detail: z.string().optional(),
});

export type SetupPlatformError = z.infer<typeof setupPlatformErrorSchema>;

export const runtimeCheckIdSchema = z.union([
	z.literal("node"),
	z.literal("npm"),
	z.literal("appium"),
	z.literal("xcuitest"),
	z.literal("uiautomator2"),
	z.literal("xcode"),
	z.literal("adb"),
]);

export type RuntimeCheckId = z.infer<typeof runtimeCheckIdSchema>;

export const runtimeCheckSchema = z.object({
	id: runtimeCheckIdSchema,
	label: z.string().min(1),
	ok: z.boolean(),
	required: z.boolean(),
	detail: z.string().optional(),
});

export type RuntimeCheck = z.infer<typeof runtimeCheckSchema>;

export const runtimeStatusSchema = z.object({
	ready: z.boolean(),
	appiumVersion: z.string().optional(),
	appiumSource: z.union([z.literal("system"), z.literal("managed")]).optional(),
	checks: z.array(runtimeCheckSchema),
});

export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const ensureRuntimeResponseSchema = z.object({
	ok: z.literal(true),
	ready: z.boolean(),
	status: runtimeStatusSchema,
	installed: z.array(setupPlatformResponseSchema),
	message: z.string().min(1),
});

export type EnsureRuntimeResponse = z.infer<typeof ensureRuntimeResponseSchema>;
