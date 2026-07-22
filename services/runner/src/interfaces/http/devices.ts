import {
	type DevicePlatform,
	devicePlatformSchema,
	listDevicesResponseSchema,
	setupPlatformRequestSchema,
	setupPlatformResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import { setupPlatform } from "../../domains/appium/application";
import { listDevices } from "../../domains/devices/application";

export function createDevicesRoutes() {
	const app = new Hono();

	app.get("/devices", async (c) => {
		const platformParam = c.req.query("platform");
		const parsedPlatform = devicePlatformSchema.safeParse(platformParam);
		if (!parsedPlatform.success) {
			return c.json(
				{ error: "Query param platform is required and must be 'ios' or 'android'" },
				400,
			);
		}

		const includeUnavailable = c.req.query("all") !== "0";
		const platform: DevicePlatform = parsedPlatform.data;
		const devices = await listDevices(platform, { includeUnavailable });

		const body = listDevicesResponseSchema.parse({
			platform,
			devices,
		});
		return c.json(body);
	});

	app.post("/devices/setup", async (c) => {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be JSON" }, 400);
		}

		const parsed = setupPlatformRequestSchema.safeParse(json);
		if (!parsed.success) {
			return c.json({ error: "Body must include platform: 'ios' or 'android'" }, 400);
		}

		try {
			const result = await setupPlatform(parsed.data.platform);
			const body = setupPlatformResponseSchema.parse(result);
			return c.json(body);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: "Failed to set up Appium drivers for this platform",
					detail: message,
				},
				500,
			);
		}
	});

	return app;
}
