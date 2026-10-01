import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ActionRequest, ActionResponse, ActionResultScreenshot } from "@yoqa/runner-client";
import { type ActionMark, overlayActionMarks } from "../runs/coord-grid";
import { performAction } from "./interaction";
import { SCREENSHOT_DIR } from "./screenshot-retention";
import type { DeviceSession } from "./session";

/** Default cap on how long to wait for the screen to settle. */
export const DEFAULT_SETTLE_CAP_MS = 1500;
/** Gap between frames while settling. Also the lead-in, so a tap's reaction has started. */
export const SETTLE_POLL_MS = 250;

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
 * Poll the screen until two consecutive frames are identical, or `capMs` passes.
 * An animating screen (a game) never settles; the latest frame is returned with `settled: false`.
 */
export async function settleScreen(
	capture: () => Promise<{ base64: string }>,
	options: { capMs?: number; pollMs?: number; clock?: SettleClock } = {},
): Promise<SettleResult> {
	const capMs = options.capMs ?? DEFAULT_SETTLE_CAP_MS;
	const pollMs = options.pollMs ?? SETTLE_POLL_MS;
	const clock = options.clock ?? realClock;
	const started = clock.now();

	let latest: string | undefined;
	let previousHash: string | undefined;
	for (;;) {
		const elapsed = clock.now() - started;
		if (latest !== undefined && elapsed >= capMs) {
			return { base64: latest, settled: false, waitedMs: elapsed };
		}
		await clock.sleep(Math.max(0, Math.min(pollMs, capMs - elapsed)));
		latest = (await capture()).base64;
		const hash = frameHash(latest);
		if (previousHash === hash) {
			return { base64: latest, settled: true, waitedMs: clock.now() - started };
		}
		previousHash = hash;
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

async function writePng(dir: string, base64: string, label: string): Promise<string> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${label}_${Date.now()}_${crypto.randomUUID()}.png`);
	await Bun.write(path, Uint8Array.from(Buffer.from(base64, "base64")));
	return path;
}

type ResultDeps = {
	perform?: typeof performAction;
	clock?: SettleClock;
	pollMs?: number;
	/** Where the images are written (default: the shared screenshot folder). */
	dir?: string;
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
	const before = await session.captureFrame().then(
		(frame) => frame.base64,
		() => undefined,
	);
	const response = await perform(session, body);
	const settle = await settleScreen(() => session.captureFrame(), {
		capMs: body.settleMs,
		pollMs: deps.pollMs,
		clock: deps.clock,
	});

	const dir = deps.dir ?? SCREENSHOT_DIR;
	const path = await writePng(dir, settle.base64, "result");
	const marks = actionMarks(body, response.resolved);
	const annotated = overlayActionMarks(settle.base64, marks);
	const annotatedPath = annotated ? await writePng(dir, annotated, "result_marked") : undefined;

	const screenshot: ActionResultScreenshot = {
		path,
		...(annotatedPath ? { annotatedPath } : {}),
		settled: settle.settled,
		waitedMs: settle.waitedMs,
		changed:
			settle.settled && before !== undefined
				? frameHash(before) !== frameHash(settle.base64)
				: null,
	};
	return { ...response, screenshot };
}
