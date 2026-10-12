import {
	iosSigningCheckRequestSchema,
	iosSigningCheckResponseSchema,
	iosSigningStatusSchema,
	setIosSigningTeamRequestSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	InvalidTeamIdError,
	checkIosSigning,
	getIosSigning,
	setIosSigningTeam,
} from "../../domains/devices/ios-signing";

export function createIosSigningRoutes() {
	const app = new Hono();

	app.get("/ios/signing", async (c) => {
		try {
			return c.json(iosSigningStatusSchema.parse(await getIosSigning()));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to read iOS signing", detail: message }, 500);
		}
	});

	app.put("/ios/signing", async (c) => {
		const json: unknown = await c.req.json().catch(() => null);
		const body = setIosSigningTeamRequestSchema.safeParse(json);
		if (!body.success) {
			return c.json({ error: "Invalid request", detail: body.error.message }, 400);
		}
		try {
			return c.json(iosSigningStatusSchema.parse(await setIosSigningTeam(body.data.team)));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = error instanceof InvalidTeamIdError ? 400 : 500;
			return c.json({ error: "Failed to set iOS signing team", detail: message }, status);
		}
	});

	app.post("/ios/signing/check", async (c) => {
		const json: unknown = await c.req.json().catch(() => null);
		const body = iosSigningCheckRequestSchema.safeParse(json);
		if (!body.success) {
			return c.json({ error: "Invalid request", detail: body.error.message }, 400);
		}
		try {
			return c.json(iosSigningCheckResponseSchema.parse(await checkIosSigning(body.data.deviceId)));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to check iOS signing", detail: message }, 500);
		}
	});

	return app;
}
