import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
	actionRequestSchema,
	actionResponseSchema,
	activeDeviceResponseSchema,
	connectDeviceRequestSchema,
	screenResponseSchema,
	screenshotRequestSchema,
	screenshotResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	SessionBusyError,
	abandonActiveSession,
	connectDevice,
	disconnectDevice,
	getActiveSessionInfo,
	isActiveSessionHeldByRun,
	isMissingAppiumSessionError,
	requireActiveSession,
} from "../../domains/devices/active-session";
import {
	ActionNotFoundError,
	ActionValidationError,
	getScreen,
	performAction,
} from "../../domains/devices/interaction";

function sessionErrorResponse(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	if (error instanceof SessionBusyError) {
		return {
			status: 409 as const,
			body: { error: error.message },
		};
	}
	if (isMissingAppiumSessionError(error)) {
		abandonActiveSession();
		return {
			status: 410 as const,
			body: {
				error: "Device session ended",
				detail: message,
			},
		};
	}
	return null;
}

export function createSessionRoutes() {
	const app = new Hono();

	app.post("/devices/connect", async (c) => {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = connectDeviceRequestSchema.safeParse(json);
		if (!parsed.success) {
			return c.json({ error: "Body must include deviceId and platform" }, 400);
		}
		try {
			const info = await connectDevice(parsed.data);
			return c.json(activeDeviceResponseSchema.parse(info));
		} catch (error) {
			const mapped = sessionErrorResponse(error);
			if (mapped) return c.json(mapped.body, mapped.status);
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to connect device", detail: message }, 500);
		}
	});

	app.get("/devices/active", (c) => {
		const info = getActiveSessionInfo();
		if (!info) {
			return c.json({ error: "No active device session" }, 404);
		}
		return c.json(activeDeviceResponseSchema.parse(info));
	});

	app.post("/devices/disconnect", async (c) => {
		try {
			const info = await disconnectDevice();
			if (!info) {
				return c.json({ error: "No active device session" }, 404);
			}
			return c.json(activeDeviceResponseSchema.parse(info));
		} catch (error) {
			const mapped = sessionErrorResponse(error);
			if (mapped) return c.json(mapped.body, mapped.status);
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to disconnect device", detail: message }, 500);
		}
	});

	app.get("/screen", async (c) => {
		try {
			const { session } = requireActiveSession();
			const full = c.req.query("full") === "1" || c.req.query("full") === "true";
			const pauseQuery = c.req.query("pauseMjpeg");
			const pauseMjpeg = pauseQuery !== "0" && pauseQuery !== "false";
			const result = await getScreen(session, { full, pauseMjpeg });
			return c.json(screenResponseSchema.parse(result));
		} catch (error) {
			const gone = sessionErrorResponse(error);
			if (gone) return c.json(gone.body, gone.status);
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to read screen", detail: message }, 500);
		}
	});

	app.post("/screenshot", async (c) => {
		let json: unknown = {};
		try {
			json = await c.req.json();
		} catch {
			json = {};
		}
		const parsed = screenshotRequestSchema.safeParse(json ?? {});
		if (!parsed.success) {
			return c.json({ error: "Invalid screenshot request" }, 400);
		}
		try {
			const { session } = requireActiveSession();
			const shot = await session.screenshot();
			let path = shot.path;
			if (parsed.data.path) {
				await mkdir(dirname(parsed.data.path), { recursive: true });
				await rename(shot.path, parsed.data.path);
				path = parsed.data.path;
			}
			return c.json(screenshotResponseSchema.parse({ path }));
		} catch (error) {
			const gone = sessionErrorResponse(error);
			if (gone) return c.json(gone.body, gone.status);
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to take screenshot", detail: message }, 500);
		}
	});

	app.get("/screenshot/image", async (c) => {
		try {
			const { session } = requireActiveSession();
			const frame = await session.captureFrame();
			const bytes = Buffer.from(frame.base64, "base64");
			return new Response(bytes, {
				status: 200,
				headers: {
					"Content-Type": frame.mime,
					"Cache-Control": "no-store",
				},
			});
		} catch (error) {
			const gone = sessionErrorResponse(error);
			if (gone) return c.json(gone.body, gone.status);
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to take screenshot", detail: message }, 500);
		}
	});

	app.get("/stream.mjpeg", async (c) => {
		return c.json(
			{
				error: "Live MJPEG stream was removed with the Appium backend",
				detail: "Poll GET /screenshot/image instead; agent-device owns streaming via record",
			},
			410,
		);
	});

	app.post("/action", async (c) => {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = actionRequestSchema.safeParse(json);
		if (!parsed.success) {
			return c.json({ error: "Invalid action request", detail: parsed.error.message }, 400);
		}
		try {
			const { session } = requireActiveSession();
			if (isActiveSessionHeldByRun()) {
				return c.json(
					{
						error: "A run is using this device session. Cancel the run to interact manually.",
					},
					409,
				);
			}
			const result = await performAction(session, parsed.data);
			return c.json(actionResponseSchema.parse(result));
		} catch (error) {
			const gone = sessionErrorResponse(error);
			if (gone) return c.json(gone.body, gone.status);
			if (error instanceof ActionValidationError) {
				return c.json({ error: error.message }, 400);
			}
			if (error instanceof ActionNotFoundError) {
				return c.json({ error: error.message }, 404);
			}
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Action failed", detail: message }, 500);
		}
	});

	return app;
}
