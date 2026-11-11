import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ActionRequest, ActionResponse, ActionResultScreenshot } from "@yoqa/runner-client";
import { type ActionMark, overlayActionMarks } from "./action-marks";
import { type AgentImage, prepareAgentImage } from "./agent-image";
import { performAction } from "./interaction";
import { SCREENSHOT_DIR } from "./screenshot-retention";
import type { DeviceSession } from "./session";

/** How long to wait for the screen to Settle, and how closely to watch it. */
export type SettlePolicy = {
	/** Cap on the whole Settle. An animating screen returns its latest frame at the cap. */
	capMs: number;
	/** Gap between frames. No fixed lead-in: the first frame is taken right after the Action. */
	pollMs: number;
	/** Identical frames must hold at least this long before the screen is settled. */
	stableWindowMs: number;
};

/** The one Settle policy for the connector and for Runs. */
export const DEFAULT_SETTLE_POLICY: SettlePolicy = {
	capMs: 1500,
	pollMs: 80,
	stableWindowMs: 160,
};

export type SettleClock = {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const realClock: SettleClock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) };

export type SettleResult = {
	base64: string;
	settled: boolean;
	waitedMs: number;
	/** The frame is from before the screen froze (`CapturedFrame.frozen`), so it shows no change. */
	frozen?: boolean;
};

/** Identifies a screenshot's bytes. Equal fingerprints mean an unchanged screen. */
export function screenFingerprint(base64: string): string {
	return String(Bun.hash(base64));
}

/**
 * Whether `frame` differs from the screenshot before it: the one notion of "screen unchanged"
 * that Settle, the connector's `changed`, Tree assist and Escalation share. Null means it cannot
 * be told: nothing came before, the screen never settled, or the frame is frozen.
 */
export function screenChanged(
	previous: string | null | undefined,
	frame: { base64: string; settled: boolean; frozen?: boolean },
): boolean | null {
	if (previous == null || !frame.settled || frame.frozen) return null;
	return screenFingerprint(previous) !== screenFingerprint(frame.base64);
}

/**
 * Poll a cheap frame source until the same frame holds for `stableWindowMs`, or `capMs` passes.
 * The first frame is taken immediately (no lead-in). An animating screen never settles;
 * the latest frame is returned with `settled: false`. A frame with `capturedAt` (from a
 * background capture) is timed by when it was captured, so the same capture read twice
 * proves nothing. A source gives `capturedAt` on every frame or on none: it is on the
 * source's clock, not the settle clock. A frozen frame is settled at once: nothing can
 * move until whatever froze it is answered.
 */
export async function settleScreen(
	capture: () => Promise<{ base64: string; capturedAt?: number; frozen?: boolean }>,
	options: Partial<SettlePolicy> & { clock?: SettleClock } = {},
): Promise<SettleResult> {
	const capMs = options.capMs ?? DEFAULT_SETTLE_POLICY.capMs;
	const pollMs = options.pollMs ?? DEFAULT_SETTLE_POLICY.pollMs;
	const stableWindowMs = options.stableWindowMs ?? DEFAULT_SETTLE_POLICY.stableWindowMs;
	const clock = options.clock ?? realClock;
	const started = clock.now();

	const first = await capture();
	if (first.frozen) {
		return { base64: first.base64, settled: true, waitedMs: clock.now() - started, frozen: true };
	}
	let latest = first.base64;
	let lastHash = screenFingerprint(latest);
	let stableSince = first.capturedAt ?? started;
	if (capMs <= 0) {
		return { base64: latest, settled: false, waitedMs: clock.now() - started };
	}

	for (;;) {
		const elapsed = clock.now() - started;
		if (elapsed >= capMs) {
			return { base64: latest, settled: false, waitedMs: elapsed };
		}
		await clock.sleep(Math.max(0, Math.min(pollMs, capMs - elapsed)));
		const frame = await capture();
		latest = frame.base64;
		const now = clock.now();
		if (frame.frozen)
			return { base64: latest, settled: true, waitedMs: now - started, frozen: true };
		const hash = screenFingerprint(latest);
		const seenAt = frame.capturedAt ?? now;
		if (hash === lastHash) {
			if (seenAt - stableSince >= stableWindowMs) {
				return { base64: latest, settled: true, waitedMs: now - started };
			}
		} else {
			lastHash = hash;
			stableSince = seenAt;
		}
	}
}

/** The Result screenshot of one Action: the raw frame Settle ended on, not yet stored. */
export type ResultFrame = SettleResult & {
	/** Whether the Action changed the screen (`screenChanged` against the frame before it). */
	changed: boolean | null;
};

export type ActAndSettleOptions = {
	/** Performs the Action itself (default: the domain `performAction`). */
	perform?: (session: DeviceSession, body: ActionRequest) => Promise<ActionResponse>;
	clock?: SettleClock;
	policy?: Partial<SettlePolicy>;
	/**
	 * The screenshot before the Action, which `changed` is judged against. Omitted: this
	 * session's last Result screenshot.
	 */
	previousFrame?: string | null;
};

export type ActAndSettleResult = {
	response: ActionResponse;
	result: ResultFrame;
	actionMs: number;
};

const lastFrameBySession = new WeakMap<DeviceSession, string>();

/**
 * Perform one Action, Settle, and return the Result screenshot: the frame the screen settled
 * on, or its latest frame at the cap with `settled: false`. Whether the Action changed the
 * screen is only claimed when it settled.
 */
export async function actAndSettle(
	session: DeviceSession,
	body: ActionRequest,
	options: ActAndSettleOptions = {},
): Promise<ActAndSettleResult> {
	const perform = options.perform ?? performAction;
	const clock = options.clock ?? realClock;
	const previousFrame =
		options.previousFrame !== undefined ? options.previousFrame : lastFrameBySession.get(session);
	const tAction = clock.now();
	const response = await perform(session, body);
	const actionMs = clock.now() - tAction;
	const settle = await settleScreen(() => session.captureFrame(), {
		...options.policy,
		clock,
	});
	lastFrameBySession.set(session, settle.base64);
	return {
		response,
		result: { ...settle, changed: screenChanged(previousFrame, settle) },
		actionMs,
	};
}

/** Where the Action landed, in 0–1000 screenshot space. Actions with no point have no mark. */
export function actionMarks(
	body: ActionRequest,
	resolved: ActionResponse["resolved"],
): ActionMark[] {
	const x = resolved?.x ?? body.x;
	const y = resolved?.y ?? body.y;
	if (x == null || y == null) return [];
	if ((body.kind === "swipe" || body.kind === "drag") && body.x2 != null && body.y2 != null) {
		return [{ kind: "path", x, y, x2: body.x2, y2: body.y2 }];
	}
	if (body.kind === "tap" || body.kind === "input") return [{ kind: "tap", x, y }];
	return [];
}

async function writeImage(
	dir: string,
	base64: string,
	label: string,
	ext: "png" | "jpg",
): Promise<string> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${label}_${Date.now()}_${crypto.randomUUID()}.${ext}`);
	await Bun.write(path, Uint8Array.from(Buffer.from(base64, "base64")));
	return path;
}

/** Store a Result screenshot (PNG) as the ground truth; returns its path. */
export async function saveResultScreenshot(
	base64: string,
	dir: string = SCREENSHOT_DIR,
): Promise<string> {
	return writeImage(dir, base64, "result", "png");
}

type ResultDeps = Omit<ActAndSettleOptions, "policy"> & {
	pollMs?: number;
	stableWindowMs?: number;
	/** Where the images are written (default: the shared screenshot folder). */
	dir?: string;
	prepareImage?: (png: string, options?: { full?: boolean; scale?: number }) => Promise<AgentImage>;
};

/**
 * The connector's adapter over `actAndSettle`: store the Result screenshot, a copy marked
 * where the Action landed, and the Agent image the caller is handed.
 */
export async function performActionWithScreenshot(
	session: DeviceSession,
	body: ActionRequest,
	deps: ResultDeps = {},
): Promise<ActionResponse> {
	const { response, result, actionMs } = await actAndSettle(session, body, {
		perform: deps.perform,
		clock: deps.clock,
		previousFrame: deps.previousFrame,
		policy: { capMs: body.settleMs, pollMs: deps.pollMs, stableWindowMs: deps.stableWindowMs },
	});

	const dir = deps.dir ?? SCREENSHOT_DIR;
	const rawPath = await saveResultScreenshot(result.base64, dir);
	const marks = actionMarks(body, response.resolved);
	const marked = overlayActionMarks(result.base64, marks);
	const annotatedPath = marked ? await writeImage(dir, marked, "result_marked", "png") : undefined;
	const prepare = deps.prepareImage ?? prepareAgentImage;
	const agent = await prepare(marked ?? result.base64, {
		full: body.fullImage,
		scale: body.imageScale,
	});
	const ext = agent.mediaType === "image/jpeg" ? "jpg" : "png";
	const agentPath = agent.downscaled
		? await writeImage(dir, agent.base64, "result_agent", ext)
		: (annotatedPath ?? rawPath);

	const screenshot: ActionResultScreenshot = {
		path: agentPath,
		...(agent.downscaled ? { rawPath } : {}),
		...(annotatedPath ? { annotatedPath } : {}),
		settled: result.settled,
		waitedMs: result.waitedMs,
		changed: result.changed,
	};
	return {
		...response,
		screenshot,
		phases: {
			captureMs: 0,
			actionMs,
			settleMs: result.waitedMs,
		},
	};
}
