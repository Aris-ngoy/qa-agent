import {
	type ActionRequest,
	type ActionResponse,
	type ScreenResponse,
	elementCenterNorm,
	findElementById,
	findElementByLabel,
} from "@yoqa/runner-client";
import { groundDescription } from "./grounding";
import { abortAllMjpegProxies } from "./mjpeg-proxy";
import { cleanPageSource } from "./screen";
import type { DeviceSession } from "./session";

export type GetScreenOptions = {
	/** When true, return raw Appium page source instead of the cleaned 0–1000 tree. */
	full?: boolean;
};

/**
 * Read the device Screen. Always pauses MJPEG proxies first so iOS WDA is not
 * dual-loaded (stream + pageSource).
 */
export async function getScreen(
	session: DeviceSession,
	options: GetScreenOptions = {},
): Promise<ScreenResponse> {
	abortAllMjpegProxies();
	const raw = await session.pageSource();
	const window = await session.getWindowSize();
	if (options.full) {
		return { full: true, window, raw };
	}
	const cleaned = cleanPageSource(raw, window);
	return {
		full: false,
		window: cleaned.window,
		elements: cleaned.elements,
	};
}

export class ActionValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ActionValidationError";
	}
}

export class ActionNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ActionNotFoundError";
	}
}

/**
 * Perform one Action on a Device Session. Resolves id/label against the cleaned
 * tree, or Grounding from description, then runs the gesture / lifecycle command.
 */
export async function performAction(
	session: DeviceSession,
	body: ActionRequest,
): Promise<ActionResponse> {
	const locatorTap = Boolean(
		(body.id || body.label) && (body.kind === "tap" || body.kind === "input"),
	);
	let x = body.x;
	let y = body.y;

	if (locatorTap) {
		const screen = await getScreen(session, { full: false });
		const elements = screen.elements ?? [];
		const match = body.id
			? findElementById(elements, body.id)
			: findElementByLabel(elements, body.label ?? "");
		if (!match) {
			throw new ActionNotFoundError(
				body.id ? `No element matching id: ${body.id}` : `No element matching label: ${body.label}`,
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

	const tapOptions = {
		durationMs: body.durationMs,
		coordSpace: locatorTap ? ("window" as const) : ("screenshot" as const),
	};

	switch (body.kind) {
		case "tap": {
			if (x == null || y == null) {
				throw new ActionValidationError("tap requires x,y or --id or --label or description");
			}
			await session.tap(x, y, tapOptions);
			if (body.double) {
				await session.tap(x, y, { coordSpace: tapOptions.coordSpace });
			}
			break;
		}
		case "swipe":
		case "drag": {
			if (x == null || y == null || body.x2 == null || body.y2 == null) {
				throw new ActionValidationError(`${body.kind} requires x,y,x2,y2`);
			}
			if (body.kind === "swipe") {
				await session.swipe(x, y, body.x2, body.y2, body.durationMs);
			} else {
				await session.drag(x, y, body.x2, body.y2, body.durationMs);
			}
			break;
		}
		case "input": {
			if (x != null && y != null) {
				await session.tap(x, y, { coordSpace: tapOptions.coordSpace });
			}
			if (!body.text) {
				throw new ActionValidationError("input requires text");
			}
			await session.type(body.text);
			break;
		}
		case "activate-app": {
			if (!body.appId) throw new ActionValidationError("activate-app requires appId");
			await session.activateApp(body.appId);
			break;
		}
		case "terminate-app": {
			if (!body.appId) throw new ActionValidationError("terminate-app requires appId");
			await session.terminateApp(body.appId);
			break;
		}
		case "restart-app": {
			if (!body.appId) throw new ActionValidationError("restart-app requires appId");
			await session.terminateApp(body.appId);
			await session.activateApp(body.appId);
			break;
		}
		case "background-app": {
			await session.backgroundApp(body.seconds ?? 3);
			break;
		}
		case "open-url": {
			if (!body.url) throw new ActionValidationError("open-url requires url");
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

	return {
		ok: true,
		kind: body.kind,
		resolved: x != null && y != null ? { x, y } : undefined,
	};
}
