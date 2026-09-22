import type { DeviceKind, DevicePlatform } from "@yoqa/runner-client";
import type { CapturedFrame, PointerPhase, SnapshotNode } from "../devices/session";
import { DeadSessionError } from "../devices/session";
import { ArgentError, MIN_ARGENT_VERSION, isDeadArgentSessionError, runArgentTool } from "./cli";
import { listArgentEntries, matchesDeviceId } from "./list-devices";
import { argentCaptureFrame, argentScreenshot, argentSnapshotNodes } from "./screen";

export { isDeadArgentSessionError };

const LIST_TIMEOUT_MS = 60_000;
const LAUNCH_TIMEOUT_MS = 300_000;
const ACTION_TIMEOUT_MS = 60_000;

/** System dialogs on a physical iPhone stay reachable outside the scoped app. */
const SPRINGBOARD_BUNDLE_ID = "com.apple.springboard";

export type ArgentWaitCondition = "exists" | "visible" | "hidden" | "text";

export type ArgentWaitSelector = {
	text?: string;
	identifier?: string;
	role?: string;
};

export type ArgentWaitOptions = {
	expectedText?: string;
	textMatch?: "contains" | "equals";
	timeoutMs?: number;
	pollIntervalMs?: number;
};

export type ArgentWaitResult = {
	success: boolean;
	elapsed?: number;
	note?: string;
	cause?: string;
	[key: string]: unknown;
};

/**
 * Exclusive-action gate — mirrors `ActionGate` in `domains/devices/session.ts`
 * so ticket 5 can treat both sessions alike. Mutating actions take the lock;
 * reads (`snapshotNodes`, `captureFrame`, `screenshot`, `getWindowSize`) only
 * go through the dead-session guard.
 */
class ArgentActionGate {
	private locked = false;
	private pointer: { startX: number; startY: number; endX: number; endY: number } | null = null;

	isPointerActive(): boolean {
		return this.pointer != null;
	}

	async withLock<T>(fn: () => Promise<T>): Promise<T> {
		if (this.pointer) throw new Error("Device is busy with live pointer control");
		if (this.locked) throw new Error("Device is busy with another action");
		this.locked = true;
		try {
			return await fn();
		} finally {
			this.locked = false;
		}
	}

	begin(x: number, y: number): void {
		if (this.locked) throw new Error("Device is busy with another action");
		this.pointer = { startX: x, startY: y, endX: x, endY: y };
	}

	move(x: number, y: number): void {
		if (!this.pointer) throw new Error("No active pointer — send begin before move/end");
		this.pointer.endX = x;
		this.pointer.endY = y;
	}

	take(): { startX: number; startY: number; endX: number; endY: number } | null {
		const current = this.pointer;
		this.pointer = null;
		return current;
	}

	cancel(): void {
		this.pointer = null;
	}
}

/** Boundary coords (0–1000 grid) to Argent wire fractions (0.0–1.0). */
function toFraction(norm: number): number {
	return Math.min(1000, Math.max(0, norm)) / 1000;
}

/** Grid coord clamped for pointer bookkeeping (mirrors `toPx` clamping). */
function clampToGrid(norm: number): number {
	return Math.round(Math.min(1000, Math.max(0, norm)));
}

function clampDuration(durationMs: number, min: number, max: number): number {
	if (!Number.isFinite(durationMs)) return min;
	return Math.min(max, Math.max(min, Math.round(durationMs)));
}

/** True when the text carries a server-side secret placeholder. */
function hasSecretPlaceholder(text: string): boolean {
	return /\{\{secret:/.test(text);
}

/**
 * Session options mirror `domains/devices/session.ts` `SessionOptions`, plus
 * the Argent-only Android `--activity` passthrough. Argent manages its own
 * runner, so there is no install step and no named `--session`.
 */
export type ArgentSessionOptions = {
	platform: DevicePlatform;
	deviceId: string;
	kind?: DeviceKind;
	bundleId?: string;
	appPackage?: string;
	/** Android launch activity — passed as `launch-app --activity` when set. */
	activity?: string;
	/** Called once when Argent reports the device (or tool-server) is gone. */
	onSessionDead?: () => void;
};

export type ArgentDeviceSession = {
	deviceId: string;
	platform: DevicePlatform;
	/** Bundle/app registered at connect (or last `activateApp`/`restartApp`). */
	readonly target: string;
	quit: () => Promise<void>;
	activateApp: (appId: string) => Promise<void>;
	openUrl: (url: string, options?: { bundleId?: string }) => Promise<void>;
	tap: (xNorm: number, yNorm: number, options?: { durationMs?: number }) => Promise<void>;
	swipe: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	drag: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	type: (text: string) => Promise<void>;
	/**
	 * Calls `argent run terminate-app`. Argent 0.25.2 ships no bare terminate
	 * tool, so this rethrows the tool-not-found `ArgentError` with an
	 * actionable hint (use `restartApp` for a clean terminate+relaunch) —
	 * never a silent success.
	 */
	terminateApp: (appId: string) => Promise<void>;
	restartApp: (appId: string) => Promise<void>;
	reinstallApp: (appPath: string, bundleId: string) => Promise<void>;
	backgroundApp: (seconds?: number) => Promise<void>;
	acceptAlert: () => Promise<void>;
	dismissAlert: () => Promise<void>;
	/** System back navigation (`button back`; unsupported on iOS). */
	back: () => Promise<void>;
	/** Semantic scroll as 1–3 deterministic center-based swipes. */
	scroll: (direction: "up" | "down" | "left" | "right", amount?: number) => Promise<void>;
	/** Bare home-screen press (`button home`). */
	home: () => Promise<void>;
	/** Device keyboard control (`keyboard --key escape|enter`). */
	keyboard: (action: "dismiss" | "enter") => Promise<void>;
	/**
	 * Settle helper for the case executor: block until the screen stops
	 * changing (`await-screen-idle`, block-until-stable). `timeoutMs` caps
	 * the wait; failures are non-fatal for callers (they settle with a sleep).
	 */
	awaitScreenIdle: (timeoutMs: number) => Promise<void>;
	/**
	 * Settle helper for the case executor: blocks until the UI element reaches
	 * the expected state (`await-ui-element`).
	 */
	waitFor: (
		condition: ArgentWaitCondition,
		selector: ArgentWaitSelector,
		options?: ArgentWaitOptions,
	) => Promise<ArgentWaitResult>;
	/** Run an exclusive device action (blocks live pointer + other actions). */
	withActionLock: <T>(fn: () => Promise<T>) => Promise<T>;
	pointerEvent: (phase: PointerPhase, xNorm: number, yNorm: number, seq: number) => Promise<void>;
	isPointerActive: () => boolean;
	/** Parsed `describe` nodes on the 0–1000 window (feeds `snapshotNodesToScreen`). */
	snapshotNodes: () => Promise<{
		nodes: SnapshotNode[];
		window: { width: number; height: number };
	}>;
	/**
	 * In-memory frame for live feed / grounding — never persists under runs/.
	 * Pass `{ fresh: true }` (stream pump) to always capture a new frame.
	 */
	captureFrame: (options?: { fresh?: boolean }) => Promise<CapturedFrame>;
	/** Persist a screenshot under ~/.yoqa/runs/screenshots/. */
	screenshot: () => Promise<{ path: string; base64: string }>;
	getWindowSize: () => Promise<{ width: number; height: number }>;
};

/**
 * At most one Argent Device Session per device id. `createDeviceSession` in
 * `domains/devices/session.ts` delegates here, so this registry is the single
 * Active Session store.
 */
const openByDeviceId = new Map<string, ArgentDeviceSession>();

/** Test-only: drop every registry entry so tests start isolated. */
export function resetArgentSessionsForTests(): void {
	openByDeviceId.clear();
}

function defaultAppFor(platform: DevicePlatform): string {
	return platform === "ios" ? "com.apple.Preferences" : "com.android.settings";
}

function openTarget(options: ArgentSessionOptions): string {
	if (options.platform === "ios") return options.bundleId?.trim() || defaultAppFor("ios");
	return options.appPackage?.trim() || defaultAppFor("android");
}

function unknownDeviceError(options: ArgentSessionOptions): Error {
	return new Error(
		`Device not found: ${options.deviceId}. List devices with: yoqa devices ${options.platform}`,
	);
}

/** Validate the target is visible to Argent before launching. */
async function ensureDevicePresent(options: ArgentSessionOptions): Promise<void> {
	const entries = await listArgentEntries({ timeoutMs: LIST_TIMEOUT_MS });
	if (!entries.some((entry) => matchesDeviceId(entry, options.deviceId))) {
		throw unknownDeviceError(options);
	}
}

function launchArgs(options: ArgentSessionOptions, target: string): string[] {
	const args = ["--udid", options.deviceId, "--bundleId", target];
	const activity = options.activity?.trim();
	if (options.platform === "android" && activity) args.push("--activity", activity);
	return args;
}

async function launchTarget(options: ArgentSessionOptions, target: string): Promise<void> {
	try {
		await runArgentTool("launch-app", launchArgs(options, target), {
			timeoutMs: LAUNCH_TIMEOUT_MS,
		});
	} catch (error) {
		// The device vanished between list-devices and launch — report it as
		// unknown rather than leaking backend stderr.
		const message = error instanceof Error ? error.message : String(error);
		if (/not found|no such device|unknown (device|udid)/i.test(message)) {
			throw unknownDeviceError(options);
		}
		throw error;
	}
}

/**
 * NOTE: the handoff names this guard `kind === "device"`, but the
 * `DeviceKind` union (`packages/runner-client/src/schemas.ts`) only has
 * `physical | simulator | emulator` — `physical` is the physical-iPhone kind.
 */
function isPhysicalIPhone(options: ArgentSessionOptions): boolean {
	return options.platform === "ios" && options.kind === "physical";
}

/**
 * Physical-iPhone single-app scope violation — the HTTP layer maps this to
 * 409 (conflict) instead of a generic 500, so the caller gets an actionable
 * "launch-app first / connect with bundleId" message.
 */
export class SingleAppScopeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SingleAppScopeError";
	}
}

function assertSingleAppScope(
	options: ArgentSessionOptions,
	registered: string,
	requested: string | undefined,
): void {
	if (!requested || !isPhysicalIPhone(options)) return;
	if (requested === registered || requested === SPRINGBOARD_BUNDLE_ID) return;
	throw new SingleAppScopeError(
		`Physical iPhone is single-app scoped to ${registered} — launch-app ${requested} first (connect with bundleId ${requested}).`,
	);
}

async function releaseExistingSession(deviceId: string): Promise<void> {
	const existing = openByDeviceId.get(deviceId);
	if (!existing) return;
	openByDeviceId.delete(deviceId);
	try {
		await existing.quit();
	} catch (error) {
		console.warn(
			"[yoqa-runner] quit prior Argent Session for exclusivity:",
			error instanceof Error ? error.message : error,
		);
	}
}

/**
 * Connect an Argent-backed device session: validate via `list-devices`, then
 * register the target with `launch-app`. No named session, no
 * close-before-open, no DEVICE_IN_USE steal path (Argent has none), no runner
 * install — Argent manages its own runner and tool-server.
 */
export async function createArgentDeviceSession(
	options: ArgentSessionOptions,
): Promise<ArgentDeviceSession> {
	await releaseExistingSession(options.deviceId);

	await ensureDevicePresent(options);
	const initialTarget = openTarget(options);
	await launchTarget(options, initialTarget);

	let currentTarget = initialTarget;
	let sessionDeadNotified = false;
	const gate = new ArgentActionGate();

	const notifySessionDead = () => {
		if (sessionDeadNotified) return;
		sessionDeadNotified = true;
		options.onSessionDead?.();
	};

	const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (error) {
			if (isDeadArgentSessionError(error)) {
				notifySessionDead();
				if (error instanceof DeadSessionError) throw error;
				throw new DeadSessionError(error instanceof Error ? error.message : String(error));
			}
			throw error;
		}
	};

	/** One exclusive device action: gate lock outside, dead-session guard inside. */
	const locked = async <T>(fn: () => Promise<T>): Promise<T> => gate.withLock(() => guard(fn));

	const owned: { current: ArgentDeviceSession | null } = { current: null };

	const quit = async () => {
		if (openByDeviceId.get(options.deviceId) === owned.current) {
			openByDeviceId.delete(options.deviceId);
		}
		gate.cancel();
		if (sessionDeadNotified) return;
		sessionDeadNotified = true;
		// Registry release IS the disconnect: Argent owns simulator-server
		// lifecycle, so quit issues no tool calls — in particular it must
		// never invoke `stop-all-simulator-servers`.
	};

	const activateApp = async (appId: string) => {
		assertSingleAppScope(options, currentTarget, appId);
		await locked(async () => {
			await runArgentTool("launch-app", ["--udid", options.deviceId, "--bundleId", appId], {
				timeoutMs: LAUNCH_TIMEOUT_MS,
			});
		});
		currentTarget = appId;
	};

	const openUrl = async (url: string, openOptions?: { bundleId?: string }) => {
		assertSingleAppScope(options, currentTarget, openOptions?.bundleId);
		await locked(async () => {
			await runArgentTool("open-url", ["--udid", options.deviceId, "--url", url], {
				timeoutMs: ACTION_TIMEOUT_MS,
			});
		});
	};

	const snapshotNodes = async (): Promise<{
		nodes: SnapshotNode[];
		window: { width: number; height: number };
	}> => guard(() => argentSnapshotNodes(options.deviceId));

	const captureFrame = async (frameOptions?: { fresh?: boolean }): Promise<CapturedFrame> =>
		guard(() => argentCaptureFrame(options.deviceId, frameOptions));

	const screenshot = async (): Promise<{ path: string; base64: string }> =>
		guard(() => argentScreenshot(options.deviceId));

	const getWindowSize = async (): Promise<{ width: number; height: number }> => {
		const fresh = await snapshotNodes();
		return fresh.window;
	};

	const tap = async (xNorm: number, yNorm: number, tapOptions?: { durationMs?: number }) => {
		const x = toFraction(xNorm);
		const y = toFraction(yNorm);
		const holdMs = tapOptions?.durationMs;
		if (holdMs != null && holdMs >= 400) {
			// Long-press: Down…Up with the hold on the release (mirror the
			// previous backend's `longpress` branch).
			const delayMs = Math.min(5000, Math.round(holdMs));
			const events = JSON.stringify([
				{ type: "Down", x, y },
				{ type: "Up", x, y, delayMs },
			]);
			await locked(async () => {
				await runArgentTool(
					"gesture-custom",
					["--udid", options.deviceId, "--events-json", events],
					{
						timeoutMs: ACTION_TIMEOUT_MS,
					},
				);
			});
			return;
		}
		await locked(async () => {
			await runArgentTool(
				"gesture-tap",
				["--udid", options.deviceId, "--x", String(x), "--y", String(y)],
				{ timeoutMs: ACTION_TIMEOUT_MS },
			);
		});
	};

	/** Raw fractional swipe — caller must already hold the gate lock. */
	const swipeFractions = async (
		fromX: number,
		fromY: number,
		toX: number,
		toY: number,
		durationMs: number,
		momentum: boolean,
	): Promise<void> => {
		const args = [
			"--udid",
			options.deviceId,
			"--fromX",
			String(fromX),
			"--fromY",
			String(fromY),
			"--toX",
			String(toX),
			"--toY",
			String(toY),
			"--durationMs",
			String(durationMs),
		];
		if (!momentum) args.push("--momentum", "false");
		await runArgentTool("gesture-swipe", args, { timeoutMs: ACTION_TIMEOUT_MS });
	};

	const swipe = async (x1: number, y1: number, x2: number, y2: number, durationMs = 400) => {
		const clamped = clampDuration(durationMs, 1, 10_000);
		await locked(async () => {
			await swipeFractions(
				toFraction(x1),
				toFraction(y1),
				toFraction(x2),
				toFraction(y2),
				clamped,
				true,
			);
		});
	};

	const drag = async (x1: number, y1: number, x2: number, y2: number, durationMs = 800) => {
		// Deterministic placement: momentum-free so the content lands where
		// the finger lifts (`momentum:false` needs durationMs >= 150).
		const clamped = clampDuration(durationMs, 150, 10_000);
		await locked(async () => {
			await swipeFractions(
				toFraction(x1),
				toFraction(y1),
				toFraction(x2),
				toFraction(y2),
				clamped,
				false,
			);
		});
	};

	const type = async (text: string) => {
		// Secret placeholders resolve server-side, and a trailing/embedded
		// newline means type+enter — both ride a single `run-sequence` so the
		// submission is one atomic keystroke run (never two bare `keyboard`
		// calls), keeping the after-typing auto-capture suppressed for it.
		const segments = text.split("\n");
		const needsSequence = hasSecretPlaceholder(text) || segments.length > 1;
		if (!needsSequence) {
			await locked(async () => {
				await runArgentTool("keyboard", ["--udid", options.deviceId, "--text", text], {
					timeoutMs: ACTION_TIMEOUT_MS,
				});
			});
			return;
		}
		const steps: Array<{ tool: string; args: Record<string, string> }> = [];
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i];
			if (segment) steps.push({ tool: "keyboard", args: { text: segment } });
			// Every newline becomes an explicit enter — `"hello\n"` is one
			// run-sequence of [keyboard text, keyboard key enter].
			if (i < segments.length - 1) steps.push({ tool: "keyboard", args: { key: "enter" } });
		}
		await locked(async () => {
			await runArgentTool(
				"run-sequence",
				["--udid", options.deviceId, "--steps-json", JSON.stringify(steps)],
				{ timeoutMs: ACTION_TIMEOUT_MS },
			);
		});
	};

	const keyboard = async (action: "dismiss" | "enter") => {
		// The previous backend's `keyboard dismiss` is the escape key on Argent.
		const key = action === "dismiss" ? "escape" : "enter";
		await locked(async () => {
			await runArgentTool("keyboard", ["--udid", options.deviceId, "--key", key], {
				timeoutMs: ACTION_TIMEOUT_MS,
			});
		});
	};

	const back = async () => {
		try {
			await locked(async () => {
				await runArgentTool("button", ["--udid", options.deviceId, "--button", "back"], {
					timeoutMs: ACTION_TIMEOUT_MS,
				});
			});
		} catch (error) {
			if (error instanceof DeadSessionError || isDeadArgentSessionError(error)) throw error;
			if (options.platform === "ios") {
				const detail = error instanceof Error ? error.message : String(error);
				throw new Error(
					`back is not supported on iOS (no system back button) — use an edge swipe or scroll instead. Argent rejected 'back': ${detail}`,
				);
			}
			throw error;
		}
	};

	const SCROLL_SPAN = 0.4;
	const SCROLL_CENTER = 0.5;
	const SCROLL_SHAPES: Record<string, [number, number, number, number]> = {
		// Finger path is opposite the content direction: scrolling content
		// down means the finger swipes up (fromY > toY).
		down: [
			SCROLL_CENTER,
			SCROLL_CENTER + SCROLL_SPAN / 2,
			SCROLL_CENTER,
			SCROLL_CENTER - SCROLL_SPAN / 2,
		],
		up: [
			SCROLL_CENTER,
			SCROLL_CENTER - SCROLL_SPAN / 2,
			SCROLL_CENTER,
			SCROLL_CENTER + SCROLL_SPAN / 2,
		],
		left: [
			SCROLL_CENTER - SCROLL_SPAN / 2,
			SCROLL_CENTER,
			SCROLL_CENTER + SCROLL_SPAN / 2,
			SCROLL_CENTER,
		],
		right: [
			SCROLL_CENTER + SCROLL_SPAN / 2,
			SCROLL_CENTER,
			SCROLL_CENTER - SCROLL_SPAN / 2,
			SCROLL_CENTER,
		],
	};

	const scroll = async (direction: "up" | "down" | "left" | "right", amount?: number) => {
		const shape = SCROLL_SHAPES[direction];
		if (!shape)
			throw new Error(`scroll direction must be up, down, left, or right (got ${direction})`);
		// `amount` is screens to scroll: fractional rounds up, capped at 3
		// swipes. Each swipe spans 0.4 of the axis (≤ 0.8 max travel) so the
		// lift point stays deterministic with `momentum:false`.
		const repeats =
			amount != null && Number.isFinite(amount) && amount > 0
				? Math.min(3, Math.max(1, Math.ceil(amount)))
				: 1;
		await locked(async () => {
			for (let i = 0; i < repeats; i++) {
				await swipeFractions(shape[0], shape[1], shape[2], shape[3], 300, false);
			}
		});
	};

	const home = async () => {
		await locked(async () => {
			await runArgentTool("button", ["--udid", options.deviceId, "--button", "home"], {
				timeoutMs: ACTION_TIMEOUT_MS,
			});
		});
	};

	const backgroundApp = async (seconds = 3) => {
		await locked(async () => {
			await runArgentTool("button", ["--udid", options.deviceId, "--button", "home"], {
				timeoutMs: ACTION_TIMEOUT_MS,
			});
		});
		await Bun.sleep(Math.min(30_000, Math.max(0, seconds * 1000)));
		const lastApp = currentTarget;
		if (lastApp) {
			try {
				await guard(async () => {
					await runArgentTool("launch-app", launchArgs(options, lastApp), {
						timeoutMs: LAUNCH_TIMEOUT_MS,
					});
				});
			} catch (error) {
				console.warn(
					"[yoqa-runner] re-foreground after background failed:",
					error instanceof Error ? error.message : error,
				);
			}
		}
	};

	const terminateApp = async (appId: string): Promise<void> => {
		await locked(async () => {
			try {
				await runArgentTool("terminate-app", ["--udid", options.deviceId, "--bundleId", appId], {
					timeoutMs: ACTION_TIMEOUT_MS,
				});
			} catch (error) {
				// Argent 0.25.2 ships no bare terminate tool — surface the real
				// tool-not-found error with a next step instead of pretending.
				if (error instanceof ArgentError && /tool ".+" not found/i.test(error.message)) {
					throw new ArgentError(
						`${error.message} — terminateApp is not supported by Argent ${MIN_ARGENT_VERSION}: use restartApp(appId) for a clean terminate+relaunch.`,
						"UNSUPPORTED",
						"Use restartApp(appId) — it terminates then relaunches in one step.",
					);
				}
				throw error;
			}
		});
	};

	const restartApp = async (appId: string) => {
		assertSingleAppScope(options, currentTarget, appId);
		await locked(async () => {
			await runArgentTool("restart-app", launchArgs(options, appId), {
				timeoutMs: LAUNCH_TIMEOUT_MS,
			});
		});
		currentTarget = appId;
	};

	const reinstallApp = async (appPath: string, bundleId: string) => {
		const path = appPath.trim();
		const target = bundleId.trim();
		if (!path) throw new Error("reinstallApp requires appPath (.app/.apk)");
		if (!target) throw new Error("reinstallApp requires bundleId");
		assertSingleAppScope(options, currentTarget, target);
		await locked(async () => {
			await runArgentTool(
				"reinstall-app",
				["--udid", options.deviceId, "--bundleId", target, "--appPath", path],
				{ timeoutMs: LAUNCH_TIMEOUT_MS },
			);
		});
	};

	const ACCEPT_LABELS = ["accept", "ok", "allow"];
	const DISMISS_LABELS = ["dismiss", "cancel", "deny"];

	/** Find a dialog button by case-insensitive substring on its label. */
	const findAlertButton = (
		nodes: SnapshotNode[],
		kind: "accept" | "dismiss",
	): SnapshotNode | null => {
		const needles = kind === "accept" ? ACCEPT_LABELS : DISMISS_LABELS;
		const matches = nodes.filter(
			(node) =>
				typeof node.label === "string" &&
				node.rect &&
				needles.some((needle) => node.label?.toLowerCase().includes(needle)),
		);
		if (matches.length === 0) return null;
		return (
			matches.find((node) => (node.role ?? "").toLowerCase().includes("button")) ??
			matches[0] ??
			null
		);
	};

	const tapAlertButton = async (kind: "accept" | "dismiss") => {
		const needles = kind === "accept" ? ACCEPT_LABELS : DISMISS_LABELS;
		await locked(async () => {
			const { nodes } = await argentSnapshotNodes(options.deviceId);
			const hit = findAlertButton(nodes, kind);
			if (!hit?.rect) {
				throw new Error(
					`No alert ${kind} button found (looked for ${needles.join("/")}) — the dialog may not be visible; describe the screen to confirm.`,
				);
			}
			const x = (hit.rect.x + hit.rect.width / 2) / 1000;
			const y = (hit.rect.y + hit.rect.height / 2) / 1000;
			await runArgentTool(
				"gesture-tap",
				["--udid", options.deviceId, "--x", String(x), "--y", String(y)],
				{ timeoutMs: ACTION_TIMEOUT_MS },
			);
		});
	};

	const acceptAlert = async () => {
		await tapAlertButton("accept");
	};

	const dismissAlert = async () => {
		await tapAlertButton("dismiss");
	};

	const WAIT_CONDITIONS: ReadonlySet<string> = new Set(["exists", "visible", "hidden", "text"]);

	const waitFor = async (
		condition: ArgentWaitCondition,
		selector: ArgentWaitSelector,
		waitOptions: ArgentWaitOptions = {},
	): Promise<ArgentWaitResult> => {
		if (!WAIT_CONDITIONS.has(condition)) {
			throw new Error(
				`waitFor condition must be exists, visible, hidden, or text (got ${String(condition)})`,
			);
		}
		if (!selector || typeof selector !== "object") {
			throw new Error("waitFor requires a selector ({ text?, identifier?, role? })");
		}
		const args = [
			"--udid",
			options.deviceId,
			"--condition",
			condition,
			"--selector-json",
			JSON.stringify(selector),
		];
		if (waitOptions.expectedText != null) args.push("--expectedText", waitOptions.expectedText);
		if (waitOptions.textMatch != null) args.push("--textMatch", waitOptions.textMatch);
		if (waitOptions.timeoutMs != null) args.push("--timeoutMs", String(waitOptions.timeoutMs));
		if (waitOptions.pollIntervalMs != null) {
			args.push("--pollIntervalMs", String(waitOptions.pollIntervalMs));
		}
		const timeoutMs =
			waitOptions.timeoutMs != null &&
			Number.isFinite(waitOptions.timeoutMs) &&
			waitOptions.timeoutMs > 0
				? waitOptions.timeoutMs + 30_000
				: ACTION_TIMEOUT_MS;
		return (await locked(async () => {
			const data = await runArgentTool("await-ui-element", args, { timeoutMs });
			return data as ArgentWaitResult;
		})) as ArgentWaitResult;
	};

	const withActionLock = <T>(fn: () => Promise<T>): Promise<T> => gate.withLock(fn);

	const isPointerActive = (): boolean => gate.isPointerActive();

	const awaitScreenIdle = async (timeoutMs: number): Promise<void> => {
		await guard(async () => {
			await runArgentTool(
				"await-screen-idle",
				[
					"--udid",
					options.deviceId,
					"--timeoutMs",
					String(Math.max(0, Math.round(timeoutMs))),
					"--pollIntervalMs",
					"200",
					"--minStableMs",
					"250",
				],
				// The tool blocks until stable; give it its own budget plus slack
				// for the poll loop rather than the fixed action timeout.
				{ timeoutMs: Math.max(0, Math.round(timeoutMs)) + 30_000 },
			);
		});
	};

	const pointerEvent = async (
		phase: PointerPhase,
		xNorm: number,
		yNorm: number,
		seq: number,
	): Promise<void> => {
		void seq;
		const x = clampToGrid(xNorm);
		const y = clampToGrid(yNorm);
		if (phase === "begin") {
			gate.begin(x, y);
			return;
		}
		if (phase === "move") {
			gate.move(x, y);
			return;
		}
		const gesture = gate.take();
		if (!gesture) throw new Error("No active pointer — send begin before move/end");
		// Grid units stand in for pixels here (the Argent window is 1000×1000);
		// mirror the <12px tap-vs-swipe split in `domains/devices/session.ts`.
		const total = Math.hypot(x - gesture.startX, y - gesture.startY);
		await guard(async () => {
			if (total < 12) {
				await runArgentTool(
					"gesture-tap",
					["--udid", options.deviceId, "--x", String(x / 1000), "--y", String(y / 1000)],
					{ timeoutMs: ACTION_TIMEOUT_MS },
				);
			} else {
				await swipeFractions(
					gesture.startX / 1000,
					gesture.startY / 1000,
					x / 1000,
					y / 1000,
					300,
					true,
				);
			}
		});
	};

	const session: ArgentDeviceSession = {
		deviceId: options.deviceId,
		platform: options.platform,
		get target() {
			return currentTarget;
		},
		quit,
		activateApp,
		openUrl,
		tap,
		swipe,
		drag,
		type,
		terminateApp,
		restartApp,
		reinstallApp,
		backgroundApp,
		acceptAlert,
		dismissAlert,
		back,
		scroll,
		home,
		keyboard,
		awaitScreenIdle,
		waitFor,
		withActionLock,
		pointerEvent,
		isPointerActive,
		snapshotNodes,
		captureFrame,
		screenshot,
		getWindowSize,
	};
	owned.current = session;

	openByDeviceId.set(options.deviceId, session);
	return session;
}
