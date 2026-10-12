import { mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import {
	actionBatchRequestSchema,
	actionBatchResponseSchema,
	actionRequestSchema,
	actionResponseSchema,
	activeDeviceResponseSchema,
	connectDeviceRequestSchema,
	retargetDeviceRequestSchema,
	screenResponseSchema,
	screenshotRequestSchema,
	screenshotResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import { performActionWithScreenshot } from "../../domains/devices/action-result";
import {
	SessionBusyError,
	abandonActiveSession,
	connectDevice,
	disconnectDevice,
	getActiveSessionInfo,
	isActiveSessionHeldByRun,
	requireActiveSession,
	retargetActiveSession,
} from "../../domains/devices/active-session";
import { performActionBatch } from "../../domains/devices/batch";
import { errorChain } from "../../domains/devices/error-chain";
import {
	ActionNotFoundError,
	ActionValidationError,
	getScreen,
	performAction,
} from "../../domains/devices/interaction";
import { DeviceUnreachableError, isDeadSessionError } from "../../domains/devices/lane";
import { trackMjpegProxy } from "../../domains/devices/mjpeg-proxy";
import { DeveloperNotTrustedError } from "../../domains/devices/yoqa-runner";

/** Map a Device Session error to its HTTP answer, or null when the route should handle it. */
/** The first error in `error`'s cause chain that is a `DeveloperNotTrustedError`. */
function developerNotTrusted(error: unknown): DeveloperNotTrustedError | null {
	for (let current = error, depth = 0; current instanceof Error && depth < 8; depth++) {
		if (current instanceof DeveloperNotTrustedError) return current;
		current = current.cause;
	}
	return null;
}

export function sessionErrorResponse(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	const untrusted = developerNotTrusted(error);
	if (untrusted) {
		// Built and installed; only the user can trust the developer on the phone, then reconnect.
		return {
			status: 428 as const,
			body: {
				error: "Developer not trusted on the iPhone",
				code: "DEVELOPER_NOT_TRUSTED" as const,
				detail: untrusted.message,
				team: untrusted.team,
				certificate: untrusted.certificate,
			},
		};
	}
	if (error instanceof SessionBusyError) {
		return {
			status: 409 as const,
			body: { error: error.message },
		};
	}
	if (error instanceof DeviceUnreachableError) {
		// An Unreachable Session: the runner keeps it until the grace runs out, then answers 410.
		return {
			status: 503 as const,
			body: {
				error: "Device unreachable",
				detail: message,
				unreachableMs: error.unreachableMs,
				graceMs: error.graceMs,
			},
		};
	}
	if (isDeadSessionError(error)) {
		abandonActiveSession();
		return {
			status: 410 as const,
			body: {
				error: "Device session ended",
				detail: message,
				chain: errorChain(error),
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
			const info = await connectDevice({
				...parsed.data,
				requestedLane: parsed.data.lane,
			});
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

	app.post("/devices/retarget", async (c) => {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = retargetDeviceRequestSchema.safeParse(json);
		if (!parsed.success) {
			return c.json({ error: "Body may only include bundleId and appPackage" }, 400);
		}
		if (!getActiveSessionInfo()) {
			return c.json({ error: "No active device session" }, 404);
		}
		try {
			return c.json(activeDeviceResponseSchema.parse(retargetActiveSession(parsed.data)));
		} catch (error) {
			const mapped = sessionErrorResponse(error);
			if (mapped) return c.json(mapped.body, mapped.status);
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to switch app", detail: message }, 500);
		}
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
		try {
			const active = requireActiveSession();
			const stream = active.session.stream;
			if (!stream?.ready) {
				return c.json(
					{
						error: "MJPEG stream not available",
						detail: "Device connected without a reachable MJPEG broadcaster",
					},
					503,
				);
			}
			const proxyAbort = trackMjpegProxy();
			let upstream: Response;
			try {
				upstream = await fetch(stream.upstreamUrl, {
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
						detail: `HTTP ${upstream.status} from mjpeg port ${stream.port}`,
					},
					502,
				);
			}
			const contentType =
				upstream.headers.get("Content-Type") ??
				"multipart/x-mixed-replace; boundary=--BoundaryLine--";
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

	app.post("/action/batch", async (c) => {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = actionBatchRequestSchema.safeParse(json);
		if (!parsed.success) {
			return c.json({ error: "Invalid action batch", detail: parsed.error.message }, 400);
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
			const result = await performActionBatch(session, {
				steps: parsed.data.steps.map((step) => ({
					...step,
					fullImage: parsed.data.fullImage ?? step.fullImage,
					imageScale: parsed.data.imageScale ?? step.imageScale,
				})),
				settleMs: parsed.data.settleMs,
			});
			return c.json(actionBatchResponseSchema.parse(result), result.ok ? 200 : 422);
		} catch (error) {
			const gone = sessionErrorResponse(error);
			if (gone) return c.json(gone.body, gone.status);
			if (error instanceof ActionValidationError) {
				return c.json({ error: error.message }, 400);
			}
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Action batch failed", detail: message }, 500);
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
			const result = parsed.data.screenshot
				? await performActionWithScreenshot(session, parsed.data)
				: await performAction(session, parsed.data);
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
