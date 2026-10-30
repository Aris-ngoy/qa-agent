import {
	type ActionRequest,
	type ActionResponse,
	type AppStorage,
	type ScreenElement,
	type ScreenResponse,
	elementCenterNorm,
	findElementById,
	findElementByLabel,
} from "@yoqa/runner-client";
import { groundDescription } from "./grounding";
import { UnsupportedKeyError } from "./lane";
import { abortAllMjpegProxies } from "./mjpeg-proxy";
import { cleanPageSource } from "./screen";
import type { DeviceSession } from "./session";

export type GetScreenOptions = {
	/** When true, return the raw accessibility tree instead of the cleaned 0–1000 tree. */
	full?: boolean;
	/**
	 * Abort live `/stream.mjpeg` proxies before pageSource (the device tool cannot serve both at once).
	 * Default true, except for a stream that survives a tree read (web). Inspector remounts
	 * the stream after the call.
	 */
	pauseMjpeg?: boolean;
};

const MJPEG_PAUSE_SETTLE_MS = 150;

async function readScreen(
	session: DeviceSession,
	options: GetScreenOptions,
): Promise<ScreenResponse> {
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

/**
 * Read the device Screen. Pauses MJPEG proxies first so the device tool is not
 * dual-loaded (stream + pageSource); Inspector remounts the stream afterward.
 */
export async function getScreen(
	session: DeviceSession,
	options: GetScreenOptions = {},
): Promise<ScreenResponse> {
	if (options.pauseMjpeg !== false && !session.stream?.survivesTreeRead) {
		const paused = abortAllMjpegProxies();
		if (paused) await Bun.sleep(MJPEG_PAUSE_SETTLE_MS);
	}
	return await readScreen(session, options);
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
 * `options.screenElements` reuses an already-read Screen (agent steps) instead of
 * re-fetching the device tree.
 */
export async function performAction(
	session: DeviceSession,
	body: ActionRequest,
	options?: { screenElements?: ScreenElement[] },
): Promise<ActionResponse> {
	const locatorTap = Boolean(
		(body.id || body.label) && (body.kind === "tap" || body.kind === "input"),
	);
	let x = body.x;
	let y = body.y;

	if (locatorTap) {
		const elements =
			options?.screenElements ?? (await getScreen(session, { full: false })).elements ?? [];
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

	let storage: AppStorage | undefined;
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
				await session.swipe(x, y, body.x2, body.y2, body.durationMs, {
					coordSpace: "screenshot",
				});
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
			if (session.restartApp) {
				({ storage } = await session.restartApp(body.appId));
			} else {
				await session.terminateApp(body.appId);
				await session.activateApp(body.appId);
			}
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
		case "key": {
			if (!body.key) throw new ActionValidationError("key requires a key");
			try {
				await session.key(body.key, body.modifiers);
			} catch (error) {
				// The Lane cannot send it: the caller asked for something invalid here.
				if (error instanceof UnsupportedKeyError) throw new ActionValidationError(error.message);
				throw error;
			}
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
		...(storage ? { storage } : {}),
	};
}
