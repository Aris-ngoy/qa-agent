import {
	type DevicePlatform,
	devicePlatformSchema,
	iosRunnerInstallRequestSchema,
	iosRunnerInstallResponseSchema,
	iosRunnerStatusResponseSchema,
	listDevicesResponseSchema,
	setupPlatformRequestSchema,
	setupPlatformResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	getYoqaRunnerStatus,
	installYoqaRunnerOnDevice,
} from "../../domains/agent-device/runner-install";
import { setupArgentPlatform } from "../../domains/argent/runtime";
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
			return c.json(
				{
					error:
						"Body must include platform: 'ios' or 'android'. Optional: deviceId, kind, xcodeDeveloperDir, developmentTeam, codeSignIdentity",
				},
				400,
			);
		}

		try {
			const result = await setupArgentPlatform(parsed.data);
			const body = setupPlatformResponseSchema.parse(result);
			return c.json(body);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: "Failed to set up the test runner for this device",
					detail: message,
				},
				500,
			);
		}
	});

	app.get("/devices/ios-runner/status", async (c) => {
		const deviceId = c.req.query("deviceId")?.trim();
		const kind = (c.req.query("kind")?.trim() || "physical") as
			| "physical"
			| "simulator"
			| "emulator";
		if (!deviceId) {
			return c.json({ error: "Query param deviceId is required" }, 400);
		}
		if (kind !== "physical" && kind !== "simulator" && kind !== "emulator") {
			return c.json({ error: "Query param kind must be physical, simulator, or emulator" }, 400);
		}
		try {
			const status = await getYoqaRunnerStatus(deviceId, kind);
			return c.json(iosRunnerStatusResponseSchema.parse(status));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to read runner status", detail: message }, 500);
		}
	});

	app.post("/devices/ios-runner/install", async (c) => {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = iosRunnerInstallRequestSchema.safeParse(json);
		if (!parsed.success) {
			return c.json({ error: "Body must include deviceId. Optional: kind, force" }, 400);
		}
		try {
			const result = await installYoqaRunnerOnDevice(parsed.data);
			return c.json(iosRunnerInstallResponseSchema.parse(result));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: "Failed to install the test runner on this device",
					detail: message,
				},
				500,
			);
		}
	});

	return app;
}
