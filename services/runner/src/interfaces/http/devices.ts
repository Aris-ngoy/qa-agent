import {
	type DevicePlatform,
	devicePlatformSchema,
	listDevicesResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import { listDevices } from "../../domains/devices/application";

export function createDevicesRoutes() {
	const app = new Hono();

	app.get("/devices", async (c) => {
		const platformParam = c.req.query("platform");
		const parsedPlatform = devicePlatformSchema.safeParse(platformParam);
		if (!parsedPlatform.success) {
			return c.json(
				{ error: "Query param platform is required and must be 'ios', 'android' or 'web'" },
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

	return app;
}
