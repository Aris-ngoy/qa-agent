import { devLog } from "@/app/dev-log";
import { logDevError, showErrorToast } from "@/app/show-error-toast";
import {
	mjpegStreamUrl,
	readScreen,
	readScreenshotBytes,
} from "@/features/inspector/data/api/screen";
import {
	isDeviceSessionGone,
	isDeviceUnreachable,
	isStaleSessionReply,
} from "@/features/inspector/utils/inspect-session";
import {
	type InspectorSelection,
	cycleChangeSelector,
	selectionFromPoint,
} from "@/features/inspector/utils/selection";
import { toast } from "@heroui/react";
import { type Observable, observable } from "@legendapp/state";
import type { ActiveDeviceResponse, ScreenElement } from "@yoqa/runner-client";

/** Log a stuck poll about every 5 s (20 ticks of the 250 ms poll). */
const POLL_SKIP_LOG_EVERY = 20;
/** Background-refresh the cached tree if older than this on select. */
const TREE_STALE_MS = 3000;
/** While the device is not answering, poll about once a second instead of every tick. */
const UNREACHABLE_POLL_EVERY = 4;

export type FeedMode = "mjpeg" | "poll";

/**
 * The Inspector's live view of the Active Session. Held in a Legend observable so the
 * 250 ms screenshot poll re-renders only the frame, not the whole page: components read
 * fields with `useValue`, the controller reads them with `.peek()`.
 */
export type InspectorFeed = {
	/** The session the Inspector is attached to; null until the user connects it. */
	active: ActiveDeviceResponse | null;
	feedMode: FeedMode | null;
	/** Current frame: an MJPEG stream URL or a blob URL from the screenshot poll. */
	imageUrl: string | null;
	/** Attaching, until the first frame arrives. */
	bootLoading: boolean;
	treeRefreshing: boolean;
	/** An Unreachable Session: the runner keeps it while it waits for the device to answer. */
	unreachable: boolean;
	elements: ScreenElement[];
	selection: InspectorSelection | null;
	liveControl: boolean;
};

export type InspectorFeed$ = Observable<InspectorFeed>;

function detachedFeed(): InspectorFeed {
	return {
		active: null,
		feedMode: null,
		imageUrl: null,
		bootLoading: false,
		treeRefreshing: false,
		unreachable: false,
		elements: [],
		selection: null,
		liveControl: false,
	};
}

function bytesToImageBlob(bytes: Uint8Array, mime = "image/png"): Blob {
	const copy = Uint8Array.from(bytes);
	return new Blob([copy.buffer], { type: mime });
}

type FeedControllerOptions = {
	/** The runner dropped the attached session: clear the shared Active Session query. */
	onSessionGone: () => void;
};

/**
 * Drives the Inspector feed outside React: attach when a Device Session is up, stream or
 * poll frames, cache the accessibility tree, and detach. Plain class so the async request
 * plumbing stays out of the component the React Compiler optimizes.
 */
export class InspectorFeedController {
	readonly feed$: InspectorFeed$ = observable(detachedFeed());

	private imageIsBlob = false;
	private inFlight = false;
	/** Poll ticks skipped in a row because a screen request was still in flight. */
	private pollSkips = 0;
	private pollTicks = 0;
	private treeUpdatedAt = 0;
	/** Bumps on each connect/clear so late 410s from a dead session cannot kill the next one. */
	private epoch = 0;

	constructor(private readonly options: FeedControllerOptions) {}

	get treeLoaded(): boolean {
		return this.treeUpdatedAt > 0;
	}

	/** The cached tree was read for another app; the next selection reads the Screen again. */
	markTreeStale(): void {
		this.treeUpdatedAt = 0;
	}

	/** Attach to `session` and start its feed. The page calls this when a Device Session is up, and from Connect. */
	async connect(session: ActiveDeviceResponse): Promise<void> {
		this.clear();
		this.feed$.active.set(session);
		devLog("Inspector connected", { deviceId: session.deviceId });
		await this.startLiveFeed(session);
	}

	disconnect(): void {
		devLog("Inspector disconnected", { deviceId: this.feed$.active.peek()?.deviceId });
		this.clear();
	}

	/** Detach: stop the feed and drop its view. The device session itself is untouched. */
	clear(): void {
		this.epoch += 1;
		this.treeUpdatedAt = 0;
		this.pollTicks = 0;
		this.setFrame(null, false);
		this.feed$.set(detachedFeed());
	}

	setLiveControl(enabled: boolean): void {
		this.feed$.liveControl.set(enabled);
		// Entering Select mode: one pageSource warm so hover/click are instant.
		if (!enabled && this.feed$.active.peek()) void this.refreshTree({ silent: true });
	}

	select(next: InspectorSelection | null): void {
		this.feed$.selection.set(next);
	}

	cycleSelector(): void {
		const prev = this.feed$.selection.peek();
		if (!prev) return;
		this.feed$.selection.set(cycleChangeSelector(this.feed$.elements.peek(), prev));
	}

	/** After a local select, refresh in the background if the cache is stale. */
	async selectWithPoint(next: InspectorSelection): Promise<void> {
		if (Date.now() - this.treeUpdatedAt <= TREE_STALE_MS) return;
		const tree = await this.refreshTree({ silent: true });
		if (!tree) return;
		const current = this.feed$.selection.peek();
		if (!current) return;
		// Control-pick / coords-only: never snap back onto a tree node.
		if (!next.element || !current.element) return;
		// Only update if this is still the same click point the user just made.
		if (current.pointX !== next.pointX || current.pointY !== next.pointY) return;
		const refreshed = selectionFromPoint(tree, { x: next.pointX, y: next.pointY });
		// Keep locator preference if the same element is still under the point.
		const sameElement =
			current.element &&
			refreshed.element &&
			(current.element.id ?? "") === (refreshed.element.id ?? "") &&
			(current.element.label ?? "") === (refreshed.element.label ?? "") &&
			current.element.x === refreshed.element.x &&
			current.element.y === refreshed.element.y;
		this.feed$.selection.set(
			sameElement ? { ...refreshed, preferredLocator: current.preferredLocator } : refreshed,
		);
	}

	/** Read the accessibility tree (pauses MJPEG briefly under Stream). */
	async refreshTree(options: { silent?: boolean } = {}): Promise<ScreenElement[] | null> {
		const silent = options.silent ?? false;
		if (this.inFlight || !this.feed$.active.peek()) return null;
		const epoch = this.epoch;
		const pauseMjpeg = this.feed$.feedMode.peek() === "mjpeg";
		this.inFlight = true;
		this.feed$.treeRefreshing.set(true);
		try {
			// pauseMjpeg aborts live stream proxies on the runner before pageSource
			// (Appium Inspector Element Mode — source without dual-loading WDA).
			const screen = await readScreen({ pauseMjpeg });
			if (this.epoch !== epoch || !this.feed$.active.peek()) return null;
			const next = screen.elements ?? [];
			this.feed$.elements.set(next);
			this.treeUpdatedAt = Date.now();
			return next;
		} catch (error) {
			if (this.epoch !== epoch) return null;
			if (isDeviceUnreachable(error) || isStaleSessionReply(error)) {
				this.noteUnreachable(error);
				return null;
			}
			// The runner drops the session before it answers 410: nothing to wait for.
			if (isDeviceSessionGone(error)) {
				this.handleSessionGone(error);
				return null;
			}
			if (!silent) {
				showErrorToast(error, "Failed to refresh screen tree");
			} else {
				logDevError("Background tree refresh failed", error);
			}
			return null;
		} finally {
			this.inFlight = false;
			this.feed$.treeRefreshing.set(false);
			if (pauseMjpeg && this.epoch === epoch && this.feed$.active.peek()) {
				void this.remountMjpegStream();
			}
		}
	}

	/** One tick of the fallback screenshot poll; about once a second while the device is unreachable. */
	async pollTick(): Promise<void> {
		if (!this.feed$.active.peek()) return;
		this.pollTicks += 1;
		if (this.feed$.unreachable.peek() && this.pollTicks % UNREACHABLE_POLL_EVERY !== 0) return;
		await this.refreshPollFrame({ includeTree: false, silent: true });
	}

	private async refreshPollFrame(options: { includeTree: boolean; silent: boolean }) {
		const { includeTree, silent } = options;
		if (this.inFlight) {
			this.pollSkips += 1;
			if (this.pollSkips % POLL_SKIP_LOG_EVERY === 0) {
				devLog("Screenshot poll skipped: a screen request is still in flight", {
					skippedTicks: this.pollSkips,
				});
			}
			return;
		}
		this.pollSkips = 0;
		if (!this.feed$.active.peek()) return;
		const epoch = this.epoch;
		this.inFlight = true;
		if (!silent && !this.feed$.imageUrl.peek()) this.feed$.bootLoading.set(true);
		try {
			const bytesPromise = readScreenshotBytes();
			const treePromise = includeTree ? readScreen() : Promise.resolve(null);
			const [bytes, screen] = await Promise.all([bytesPromise, treePromise]);
			if (this.epoch !== epoch || !this.feed$.active.peek()) return;
			if (this.feed$.unreachable.peek()) {
				this.feed$.unreachable.set(false);
				devLog("Screenshot poll: the device answers again");
			}
			this.setFrame(URL.createObjectURL(bytesToImageBlob(bytes)), true);
			if (screen) {
				this.feed$.elements.set(screen.elements ?? []);
				this.treeUpdatedAt = Date.now();
			}
		} catch (error) {
			if (this.epoch !== epoch) return;
			// The runner owns the grace window: a 503 keeps the last frame, a 410 is final.
			if (isDeviceUnreachable(error) || isStaleSessionReply(error)) {
				this.noteUnreachable(error);
				return;
			}
			if (isDeviceSessionGone(error)) {
				this.handleSessionGone(error);
				return;
			}
			if (!silent) {
				showErrorToast(error, "Failed to refresh screen");
			} else {
				logDevError("Screenshot poll failed", error);
			}
		} finally {
			this.inFlight = false;
			this.feed$.bootLoading.set(false);
		}
	}

	/**
	 * The Inspector Session cannot reach the phone: keep the last frame, poll slower and log
	 * once. That does not end the Device Session. A later 410 means a gesture's session died.
	 */
	private noteUnreachable(error: unknown): void {
		if (this.feed$.unreachable.peek()) return;
		this.feed$.unreachable.set(true);
		logDevError("Device unreachable, the runner is waiting for it", error);
	}

	private async startLiveFeed(deviceInfo: ActiveDeviceResponse): Promise<void> {
		this.feed$.bootLoading.set(true);
		try {
			if (deviceInfo.streamReady !== false && (deviceInfo.streamUrl || deviceInfo.mjpegPort)) {
				this.feed$.feedMode.set("mjpeg");
				// Cache-bust so a stuck <img> MJPEG connection is remounted.
				this.setFrame(`${await mjpegStreamUrl()}?t=${Date.now()}`, false);
				// Do not page-source while MJPEG is starting — WDA dies a few seconds later.
				// Tree is loaded after script/commands (and on poll feed).
			} else {
				this.feed$.feedMode.set("poll");
				await this.refreshPollFrame({ includeTree: true, silent: false });
			}
		} catch (error) {
			showErrorToast(error, "Failed to start live feed");
			this.feed$.feedMode.set("poll");
			await this.refreshPollFrame({ includeTree: true, silent: true });
		} finally {
			this.feed$.bootLoading.set(false);
		}
	}

	private async remountMjpegStream(): Promise<void> {
		if (this.feed$.feedMode.peek() !== "mjpeg" || !this.feed$.active.peek()) return;
		this.setFrame(`${await mjpegStreamUrl()}?t=${Date.now()}`, false);
	}

	/** Show `url` as the frame, revoking the previous frame if it was a poll blob. */
	private setFrame(url: string | null, isBlob: boolean): void {
		const previous = this.feed$.imageUrl.peek();
		if (previous && this.imageIsBlob) URL.revokeObjectURL(previous);
		this.imageIsBlob = isBlob;
		this.feed$.imageUrl.set(url);
	}

	private handleSessionGone(error: unknown): void {
		logDevError("Device session ended", error);
		this.clear();
		this.options.onSessionGone();
		toast.success("Device session ended — reconnect from the top bar");
	}
}
