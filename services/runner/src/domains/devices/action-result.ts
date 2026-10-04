import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ActionRequest, ActionResponse, ActionResultScreenshot } from "@yoqa/runner-client";
import { type ActionMark, overlayActionMarks } from "../runs/coord-grid";
import { type AgentImage, prepareAgentImage } from "./agent-image";
import { performAction } from "./interaction";
import { SCREENSHOT_DIR } from "./screenshot-retention";
import type { DeviceSession } from "./session";

/** Default cap on how long to wait for the screen to settle. */
export const DEFAULT_SETTLE_CAP_MS = 1500;
/** Gap between frames while settling. No fixed lead-in — the first frame is taken immediately. */
export const SETTLE_POLL_MS = 80;
/** Identical frames must hold at least this long before the screen is settled. */
export const SETTLE_STABLE_WINDOW_MS = 160;

type SettleClock = {
	now: () => number;
	sleep: (ms: number) => Promise<void>;
};

const realClock: SettleClock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) };

export type SettleResult = {
	base64: string;
	settled: boolean;
	waitedMs: number;
};

function frameHash(base64: string): string {
	return String(Bun.hash(base64));
}

/**
 * Poll a cheap frame source until the same frame holds for `stableWindowMs`, or `capMs` passes.
 * The first frame is taken immediately (no lead-in). An animating screen never settles;
 * the latest frame is returned with `settled: false`.
 */
export async function settleScreen(
	capture: () => Promise<{ base64: string }>,
	options: { capMs?: number; pollMs?: number; stableWindowMs?: number; clock?: SettleClock } = {},
): Promise<SettleResult> {
	const capMs = options.capMs ?? DEFAULT_SETTLE_CAP_MS;
	const pollMs = options.pollMs ?? SETTLE_POLL_MS;
	const stableWindowMs = options.stableWindowMs ?? SETTLE_STABLE_WINDOW_MS;
	const clock = options.clock ?? realClock;
	const started = clock.now();

	let latest = (await capture()).base64;
	let lastHash = frameHash(latest);
	let stableSince = started;
	if (capMs <= 0) {
		return { base64: latest, settled: false, waitedMs: clock.now() - started };
	}

	for (;;) {
		const elapsed = clock.now() - started;
		if (elapsed >= capMs) {
			return { base64: latest, settled: false, waitedMs: elapsed };
		}
		await clock.sleep(Math.max(0, Math.min(pollMs, capMs - elapsed)));
		latest = (await capture()).base64;
		const hash = frameHash(latest);
		const now = clock.now();
		if (hash === lastHash) {
			if (now - stableSince >= stableWindowMs) {
				return { base64: latest, settled: true, waitedMs: now - started };
			}
		} else {
			lastHash = hash;
			stableSince = now;
		}
	}
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

async function writePng(dir: string, base64: string, label: string): Promise<string> {
	return writeImage(dir, base64, label, "png");
}

const lastFrameBySession = new WeakMap<DeviceSession, string>();

type ResultDeps = {
	perform?: typeof performAction;
	clock?: SettleClock;
	pollMs?: number;
	stableWindowMs?: number;
	/** Where the images are written (default: the shared screenshot folder). */
	dir?: string;
	prepareImage?: (png: string, options?: { full?: boolean; scale?: number }) => Promise<AgentImage>;
	/** Previous Result frame (base64). Tests inject this; live callers reuse the last Result. */
	previousFrame?: string;
};

/**
 * Perform one Action, Settle, and return the Result screenshot with it. The frame before the
 * Action tells us whether it changed anything; that is only claimed when the screen settled.
 */
export async function performActionWithScreenshot(
	session: DeviceSession,
	body: ActionRequest,
	deps: ResultDeps = {},
): Promise<ActionResponse> {
	const perform = deps.perform ?? performAction;
	const clock = deps.clock ?? realClock;
	const previousFrame = deps.previousFrame ?? lastFrameBySession.get(session);
	const tAction = clock.now();
	const response = await perform(session, body);
	const actionMs = clock.now() - tAction;
	const settle = await settleScreen(() => session.captureFrame(), {
		capMs: body.settleMs,
		pollMs: deps.pollMs,
		stableWindowMs: deps.stableWindowMs,
		clock,
	});
	lastFrameBySession.set(session, settle.base64);

	const dir = deps.dir ?? SCREENSHOT_DIR;
	const rawPath = await writePng(dir, settle.base64, "result");
	const marks = actionMarks(body, response.resolved);
	const marked = overlayActionMarks(settle.base64, marks);
	const annotatedPath = marked ? await writePng(dir, marked, "result_marked") : undefined;
	const prepare = deps.prepareImage ?? prepareAgentImage;
	const agent = await prepare(marked ?? settle.base64, {
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
		settled: settle.settled,
		waitedMs: settle.waitedMs,
		changed:
			settle.settled && previousFrame !== undefined
				? frameHash(previousFrame) !== frameHash(settle.base64)
				: null,
	};
	return {
		...response,
		screenshot,
		phases: {
			captureMs: 0,
			actionMs,
			settleMs: settle.waitedMs,
		},
	};
}
