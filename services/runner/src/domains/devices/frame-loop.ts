import { type CapturedFrame, DeadSessionError, isDeadSessionError } from "./lane";

/** Back off this long after a failed capture, so a broken tool doesn't spin the loop. */
const RETRY_AFTER_ERROR_MS = 100;

type Waiter = {
	after: number;
	resolve: (frame: CapturedFrame) => void;
	reject: (error: unknown) => void;
};

export type FrameLoop = {
	/**
	 * The latest frame whose capture started at or after `after` (a `performance.now()` time).
	 * Never starts a capture of its own: it waits for the loop when the latest frame is older.
	 */
	read: (after?: number) => Promise<CapturedFrame>;
	/**
	 * Input just changed the screen: start one capture now, next to the one in flight, so a
	 * read after the input waits for one capture rather than the rest of an older one too.
	 */
	kick: () => void;
	/** Stop capturing. Pending and later reads reject. Safe to call twice. */
	stop: () => void;
};

/**
 * Captures frames back to back in the background, so a cheap read returns the latest one.
 * The loop starts on the first read and pauses after `idleMs` without one. A Dead Session
 * stops it for good. Each frame carries `capturedAt`, the time its capture started.
 */
export function createFrameLoop(
	capture: () => Promise<CapturedFrame>,
	options: { idleMs?: number } = {},
): FrameLoop {
	const idleMs = options.idleMs ?? 2000;
	const now = () => performance.now();
	let latest: CapturedFrame | null = null;
	let fatal: unknown = null;
	let running = false;
	let kicked = false;
	let lastRead = 0;
	let waiters: Waiter[] = [];

	const fresh = (frame: CapturedFrame | null, after: number): frame is CapturedFrame =>
		frame !== null && (frame.capturedAt ?? 0) >= after;

	const settleWaiters = (frame: CapturedFrame) => {
		const ready = waiters.filter((w) => fresh(frame, w.after));
		waiters = waiters.filter((w) => !fresh(frame, w.after));
		for (const w of ready) w.resolve(frame);
	};

	const rejectWaiters = (error: unknown) => {
		const all = waiters;
		waiters = [];
		for (const w of all) w.reject(error);
	};

	/**
	 * One capture. Resolves false when it failed and the caller should back off. Only the
	 * loop's own failures fail waiting reads; a failed kick leaves them to the loop.
	 */
	const captureOnce = async (failWaiters: boolean): Promise<boolean> => {
		const startedAt = now();
		try {
			const frame = await capture();
			if (fatal) return true;
			// Captures can overlap after a kick; never replace a newer frame with an older one.
			if (!latest || startedAt >= (latest.capturedAt ?? 0)) {
				latest = { ...frame, capturedAt: startedAt };
			}
			settleWaiters(latest);
			return true;
		} catch (error) {
			if (fatal) return true;
			if (isDeadSessionError(error)) fatal = error;
			if (fatal || failWaiters) rejectWaiters(error);
			return false;
		}
	};

	const run = async () => {
		running = true;
		while (!fatal && (waiters.length > 0 || now() - lastRead < idleMs)) {
			if (!(await captureOnce(true)) && !fatal) await Bun.sleep(RETRY_AFTER_ERROR_MS);
		}
		running = false;
	};

	return {
		read: (after = 0) => {
			if (fatal) return Promise.reject(fatal);
			lastRead = now();
			if (fresh(latest, after)) return Promise.resolve(latest);
			const pending = new Promise<CapturedFrame>((resolve, reject) => {
				waiters.push({ after, resolve, reject });
			});
			if (!running) void run();
			return pending;
		},
		kick: () => {
			if (fatal || !running || kicked) return;
			kicked = true;
			void captureOnce(false).finally(() => {
				kicked = false;
			});
		},
		stop: () => {
			if (fatal) return;
			fatal = new DeadSessionError("Device session ended");
			rejectWaiters(fatal);
		},
	};
}
