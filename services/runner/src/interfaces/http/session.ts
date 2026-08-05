import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
	actionRequestSchema,
	actionResponseSchema,
	activeDeviceResponseSchema,
	connectDeviceRequestSchema,
	elementCenterNorm,
	findElementById,
	findElementByLabel,
	screenResponseSchema,
	screenshotRequestSchema,
	screenshotResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	abandonActiveSession,
	connectDevice,
	disconnectDevice,
	getActiveSessionInfo,
	isMissingAppiumSessionError,
	requireActiveSession,
} from "../../domains/devices/active-session";
import { groundDescription } from "../../domains/devices/grounding";
import { trackMjpegProxy } from "../../domains/devices/mjpeg-proxy";
import { cleanPageSource } from "../../domains/devices/screen";

function sessionErrorResponse(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
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
		const info = await disconnectDevice();
		if (!info) {
			return c.json({ error: "No active device session" }, 404);
		}
		return c.json(activeDeviceResponseSchema.parse(info));
	});

	app.get("/screen", async (c) => {
		try {
			const { session } = requireActiveSession();
			const full = c.req.query("full") === "1" || c.req.query("full") === "true";
			const raw = await session.pageSource();
			const window = await session.getWindowSize();
			if (full) {
				return c.json(
					screenResponseSchema.parse({
						full: true,
						window,
						raw,
					}),
				);
			}
			const cleaned = cleanPageSource(raw, window);
			return c.json(
				screenResponseSchema.parse({
					full: false,
					window: cleaned.window,
					elements: cleaned.elements,
				}),
			);
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
		try {
			const active = requireActiveSession();
			if (!active.streamReady || !active.mjpegPort) {
				return c.json(
					{
						error: "MJPEG stream not available",
						detail: "Device connected without a reachable Appium MJPEG broadcaster",
					},
					503,
				);
			}
			const proxyAbort = trackMjpegProxy();
			let upstream: Response;
			try {
				upstream = await fetch(`http://127.0.0.1:${active.mjpegPort}/`, {
					signal: proxyAbort.signal,
					headers: { Accept: "multipart/x-mixed-replace,image/jpeg,*/*" },
				});
			} catch (error) {
				if (proxyAbort.signal.aborted) {
					return c.json({ error: "MJPEG proxy aborted" }, 503);
				}
				throw error;
			}
			if (!upstream.ok || !upstream.body) {
				proxyAbort.abort();
				return c.json(
					{
						error: "Upstream MJPEG unavailable",
						detail: `HTTP ${upstream.status} from mjpeg port ${active.mjpegPort}`,
					},
					502,
				);
			}
			const contentType =
				upstream.headers.get("Content-Type") ??
				"multipart/x-mixed-replace; boundary=--BoundaryLine--";
			// Aborting proxyAbort cancels the upstream body when disconnect/quit runs.
			return new Response(upstream.body, {
				status: 200,
				headers: {
					"Content-Type": contentType,
					"Cache-Control": "no-store",
					Connection: "close",
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to proxy MJPEG stream", detail: message }, 500);
		}
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
		const body = parsed.data;
		try {
			const { session } = requireActiveSession();
			let x = body.x;
			let y = body.y;

			if (
				(body.id || body.label) &&
				(body.kind === "tap" || body.kind === "input") &&
				(x == null || y == null)
			) {
				const raw = await session.pageSource();
				const window = await session.getWindowSize();
				const cleaned = cleanPageSource(raw, window);
				const match = body.id
					? findElementById(cleaned.elements, body.id)
					: findElementByLabel(cleaned.elements, body.label ?? "");
				if (!match) {
					return c.json(
						{
							error: body.id ? "No element matching id" : "No element matching label",
							detail: body.id ?? body.label,
						},
						404,
					);
				}
				const center = elementCenterNorm(match);
				x = center.x;
				y = center.y;
			} else if (body.description && (body.kind === "tap" || body.kind === "input")) {
				const grounded = await groundDescription(session, body.description);
				x = grounded.x;
				y = grounded.y;
			}

			switch (body.kind) {
				case "tap": {
					if (x == null || y == null) {
						return c.json({ error: "tap requires x,y or --id or --label or description" }, 400);
					}
					await session.tap(x, y, { durationMs: body.durationMs });
					if (body.double) {
						await session.tap(x, y);
					}
					break;
				}
				case "swipe":
				case "drag": {
					if (x == null || y == null || body.x2 == null || body.y2 == null) {
						return c.json({ error: `${body.kind} requires x,y,x2,y2` }, 400);
					}
					if (body.kind === "swipe") {
						await session.swipe(x, y, body.x2, body.y2, body.durationMs);
					} else {
						await session.drag(x, y, body.x2, body.y2, body.durationMs);
					}
					break;
				}
				case "input": {
					// Focus the target whenever coordinates are known (id/label/description/x,y).
					if (x != null && y != null) {
						await session.tap(x, y);
					}
					if (!body.text) {
						return c.json({ error: "input requires text" }, 400);
					}
					await session.type(body.text);
					break;
				}
				case "activate-app": {
					if (!body.appId) return c.json({ error: "activate-app requires appId" }, 400);
					await session.activateApp(body.appId);
					break;
				}
				case "terminate-app": {
					if (!body.appId) return c.json({ error: "terminate-app requires appId" }, 400);
					await session.terminateApp(body.appId);
					break;
				}
				case "restart-app": {
					if (!body.appId) return c.json({ error: "restart-app requires appId" }, 400);
					await session.terminateApp(body.appId);
					await session.activateApp(body.appId);
					break;
				}
				case "background-app": {
					await session.backgroundApp(body.seconds ?? 3);
					break;
				}
				case "open-url": {
					if (!body.url) return c.json({ error: "open-url requires url" }, 400);
					await session.openUrl(body.url);
					break;
				}
				case "alert": {
					if (body.alertAction === "dismiss") {
						await session.dismissAlert();
					} else {
						await session.acceptAlert();
					}
					break;
				}
			}

			return c.json(
				actionResponseSchema.parse({
					ok: true,
					kind: body.kind,
					resolved: x != null && y != null ? { x, y } : undefined,
				}),
			);
		} catch (error) {
			const gone = sessionErrorResponse(error);
			if (gone) return c.json(gone.body, gone.status);
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Action failed", detail: message }, 500);
		}
	});

	return app;
}
