import { type ActiveDeviceResponse, controlScreenChangedMessageSchema } from "@yoqa/runner-client";
import { treeReadPausesStream } from "./inspect-session";

/** Background-refresh the cached tree if older than this on select. */
export const TREE_STALE_MS = 3000;

/** When the cached tree's read began and when it came back; both 0 before the first. */
export type TreeRead = { startedAt: number; doneAt: number };

/**
 * Whether a click reads the Screen again rather than trust the cached tree. Any tree goes
 * stale with time. A web tree is also stale once the page changed after its read began
 * (`changedAt`, from the runner's screen-changed signal or an Inspector action), so the
 * hover tree is never older than the frame on screen.
 */
export function isTreeStale(
	read: TreeRead,
	page: { session: ActiveDeviceResponse; changedAt: number },
	now: number,
): boolean {
	if (read.doneAt === 0 || now - read.doneAt > TREE_STALE_MS) return true;
	return !treeReadPausesStream(page.session) && page.changedAt >= read.startedAt;
}

/**
 * What the page changing does to the tree: read it now, once more when the read in flight
 * ends (however many changes came during it), or nothing. Under live control the tree waits
 * for Select mode, which reads it on the way in. A phone's tree read cuts its Stream, so a
 * phone keeps its timer and is never read on a change.
 */
export function treeReadOnScreenChange(
	session: ActiveDeviceResponse,
	state: { reading: boolean; liveControl: boolean },
): "read" | "after-read" | "none" {
	if (treeReadPausesStream(session) || state.liveControl) return "none";
	return state.reading ? "after-read" : "read";
}

/**
 * Whether the Inspector holds the control socket open: on web always, for the runner's
 * screen-changed signal; on a phone only under live control, for its pointer.
 */
export function controlSocketWanted(session: ActiveDeviceResponse, liveControl: boolean): boolean {
	return liveControl || session.platform === "web";
}

/** True for the runner's screen-changed message on the control socket. */
export function isScreenChangedMessage(data: unknown): boolean {
	if (typeof data !== "string") return false;
	try {
		return controlScreenChangedMessageSchema.safeParse(JSON.parse(data)).success;
	} catch {
		return false;
	}
}
