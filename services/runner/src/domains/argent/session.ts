import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceKind, DevicePlatform } from "@yoqa/runner-client";
import { type ArgentError, isDeadArgentSessionError, runArgentTool } from "./cli";

const YOQA_ROOT = join(process.env.HOME ?? tmpdir(), ".yoqa");
const SCREENSHOT_DIR = join(YOQA_ROOT, "runs", "screenshots");
const OPEN_TIMEOUT_MS = 300_000;

/** Stable error for a Device Session Argent has already dropped. */
export class DeadSessionError extends Error {
	constructor(message = "Device session ended") {
		super(message);
		this.name = "DeadSessionError";
	}
}

/** True when Argent reports the session is gone (Dead Session). */
export function isDeadSessionError(error: unknown): boolean {
	if (error instanceof DeadSessionError) return true;
	if (isDeadArgentSessionError(error)) return true;
	const message = error instanceof Error ? error.message : String(error);
	return /session does not exist|invalid session|no such session|no active device session|no active session|session.+not found|terminated or not started|session is either terminated|transport.+not wired|not reachable/i.test(
		message,
	);
}

export type SessionOptions = {
	platform: DevicePlatform;
	deviceId: string;
	kind?: DeviceKind;
	bundleId?: string;
	appPackage?: string;
	onSessionDead?: () => void;
};

export type CapturedFrame = {
	base64: string;
	mime: "image/png" | "image/jpeg";
};

export type PointerPhase = "begin" | "move" | "end";

export type SnapshotNode = {
	ref: string;
	type?: string;
	role?: string;
	label?: string;
	value?: string;
	identifier?: string;
	rect?: { x: number; y: number; width: number; height: number };
	enabled?: boolean;
};

export type DeviceSession = {
	quit: () => Promise<void>;
	captureFrame: (options?: { fresh?: boolean }) => Promise<CapturedFrame>;
	screenshot: () => Promise<{ path: string; base64: string }>;
	snapshotNodes: () => Promise<{
		nodes: SnapshotNode[];
		window: { width: number; height: number };
	}>;
	getWindowSize: () => Promise<{ width: number; height: number }>;
	tap: (xNorm: number, yNorm: number, options?: { durationMs?: number }) => Promise<void>;
	swipe: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	drag: (x1: number, y1: number, x2: number, y2: number, durationMs?: number) => Promise<void>;
	type: (text: string) => Promise<void>;
	activateApp: (appId: string) => Promise<void>;
	terminateApp: (appId: string) => Promise<void>;
	backgroundApp: (seconds?: number) => Promise<void>;
	openUrl: (url: string) => Promise<void>;
	acceptAlert: () => Promise<void>;
	dismissAlert: () => Promise<void>;
	back: () => Promise<void>;
	scroll: (direction: "up" | "down" | "left" | "right", amount?: number) => Promise<void>;
	home: () => Promise<void>;
	keyboard: (action: "dismiss" | "enter") => Promise<void>;
	withActionLock: <T>(fn: () => Promise<T>) => Promise<T>;
	pointerEvent: (phase: PointerPhase, xNorm: number, yNorm: number, seq: number) => Promise<void>;
	isPointerActive: () => boolean;
};

/** At most one Device Session per device id (Active Session or Run). */
const openByDeviceId = new Map<string, DeviceSession>();

function defaultWindowFor(platform: DevicePlatform): { width: number; height: number } {
	return platform === "ios" ? { width: 402, height: 874 } : { width: 412, height: 915 };
}

function toFrac(norm1000: number): number {
	return Math.min(1, Math.max(0, norm1000 / 1000));
}

function defaultAppFor(platform: DevicePlatform): string {
	return platform === "ios" ? "com.apple.Preferences" : "com.android.settings";
}

function openTarget(options: SessionOptions): string {
	if (options.platform === "ios") return options.bundleId?.trim() || defaultAppFor("ios");
	return options.appPackage?.trim() || defaultAppFor("android");
}

async function releaseExistingSession(deviceId: string): Promise<void> {
	const existing = openByDeviceId.get(deviceId);
	if (!existing) return;
	openByDeviceId.delete(deviceId);
	try {
		await existing.quit();
	} catch (error) {
		console.warn(
			"[yoqa-runner] quit prior Device Session for exclusivity:",
			error instanceof Error ? error.message : error,
		);
	}
}

/**
 * Argent has no named sessions — takeover is a no-op passthrough kept for
 * API compatibility while callers migrate off session addresses.
 */
export async function withDeviceInUseTakeover<T>(run: () => Promise<T>): Promise<T> {
	return run();
}

/**
 * Argent builds and signs its runner automatically on first interaction, so
 * there is never a manual check-and-install step on connect.
 */
export function shouldAutoInstallRunnerOnConnect(): boolean {
	return false;
}

type DescribePayload = {
	description?: string;
	source?: string;
};

const FRAME_RE =
	/(?:frame|rect|bounds)\s*[:=]?\s*[^0-9]*?x\s*=\s*([\d.]+)\s*[, ]\s*y\s*=\s*([\d.]+)\s*[, ]\s*(?:w(?:idth)?|x2)\s*=\s*([\d.]+)\s*[, ]\s*(?:h(?:eight)?|y2)\s*=\s*([\d.]+)/i;
const UIA_BOUNDS_RE = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/;

function parseDescribeLines(
	description: string,
	window: { width: number; height: number },
): SnapshotNode[] {
	const nodes: SnapshotNode[] = [];
	const lines = description.split("\n");
	let idx = 0;
	for (const line of lines) {
		const text = line.trim();
		if (!text || text.startsWith("Tap an element") || text.startsWith("To tap")) continue;
		const frame = FRAME_RE.exec(text);
		const quoted = /"([^"]+)"/.exec(text);
		const roleMatch = /^(?:[-*•\d.)\s]*)([A-Za-z][A-Za-z0-9 _-]*)/.exec(text);
		const idMatch =
			/(?:accessibility-?id|resource-?id|identifier|nativeID)\s*[:=]\s*([^\s,\]]+)/i.exec(text);
		const label = quoted?.[1]?.trim() ?? "";
		const role = roleMatch?.[1]?.trim() || "node";
		if (!frame && !label) continue;
		let rect: SnapshotNode["rect"];
		if (frame) {
			const nums = frame.slice(1, 5).map(Number);
			const [fx, fy, fw, fh] = nums;
			if (
				fx != null &&
				fy != null &&
				fw != null &&
				fh != null &&
				[fx, fy, fw, fh].every((n) => Number.isFinite(n)) &&
				fw > 0 &&
				fh > 0 &&
				fx <= 1.01 &&
				fy <= 1.01
			) {
				rect = {
					x: Math.round(fx * window.width),
					y: Math.round(fy * window.height),
					width: Math.round(fw * window.width),
					height: Math.round(fh * window.height),
				};
			}
		}
		if (!rect && !label) continue;
		nodes.push({
			ref: `a${idx++}`,
			type: role,
			role,
			label: label || undefined,
			identifier: idMatch?.[1]?.trim(),
			rect,
			enabled: !/disabled/i.test(text),
		});
	}
	return nodes;
}

function parseUiaSource(
	source: string,
	window: { width: number; height: number },
	startIdx: number,
): SnapshotNode[] {
	const nodes: SnapshotNode[] = [];
	const nodeTags = source.match(/<node\b[^>]*>/g) ?? [];
	let idx = startIdx;
	for (const tag of nodeTags) {
		const bounds = UIA_BOUNDS_RE.exec(tag);
		const text = /(?:text|content-desc|label)="([^"]*)"/.exec(tag);
		const className = /class="([^"]*)"/.exec(tag);
		const resourceId = /resource-id="([^"]*)"/.exec(tag);
		const label = text?.[1]?.trim() ?? "";
		if (!bounds && !label) continue;
		let rect: SnapshotNode["rect"];
		if (bounds) {
			const nums = bounds.slice(1, 5).map(Number);
			const [x1, y1, x2, y2] = nums;
			if (x1 != null && y1 != null && x2 != null && y2 != null && x2 > x1 && y2 > y1) {
				rect = { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
			}
		}
		if (!rect && !label) continue;
		const role = className?.[1]?.split(".").pop() || "node";
		nodes.push({
			ref: `a${idx++}`,
			type: role,
			role,
			label: label || undefined,
			identifier: resourceId?.[1]?.trim() || undefined,
			rect,
			enabled: true,
		});
	}
	void window;
	return nodes;
}

export function parseDescribeToNodes(
	payload: DescribePayload,
	window: { width: number; height: number },
): SnapshotNode[] {
	const nodes = parseDescribeLines(payload.description ?? "", window);
	if (payload.source && /<node\b/.test(payload.source)) {
		nodes.push(...parseUiaSource(payload.source, window, nodes.length));
	}
	return nodes;
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
	if (bytes.length < 26) return null;
	if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
		return null;
	}
	const w0 = bytes[16];
	const w1 = bytes[17];
	const w2 = bytes[18];
	const w3 = bytes[19];
	const h0 = bytes[20];
	const h1 = bytes[21];
	const h2 = bytes[22];
	const h3 = bytes[23];
	if (
		w0 == null ||
		w1 == null ||
		w2 == null ||
		w3 == null ||
		h0 == null ||
		h1 == null ||
		h2 == null ||
		h3 == null
	) {
		return null;
	}
	const width = (w0 << 24) | (w1 << 16) | (w2 << 8) | w3;
	const height = (h0 << 24) | (h1 << 16) | (h2 << 8) | h3;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width < 50 || height < 50) {
		return null;
	}
	return { width, height };
}

async function readImageFile(path: string): Promise<{ base64: string; bytes: Uint8Array }> {
	const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
	return { base64: Buffer.from(bytes).toString("base64"), bytes };
}

class ActionGate {
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

export async function createDeviceSession(options: SessionOptions): Promise<DeviceSession> {
	await releaseExistingSession(options.deviceId);

	const udid = options.deviceId;
	const target = openTarget(options);

	// Boot + launch. Argent builds/signs its runner on first interaction, so
	// this also covers the old manual runner install step (Argent auto-builds).
	try {
		if (options.kind === "simulator" && options.platform === "ios") {
			await runArgentTool("boot-device", { udid }, { timeoutMs: OPEN_TIMEOUT_MS }).catch(
				() => undefined,
			);
		}
		await runArgentTool("launch-app", { udid, bundleId: target }, { timeoutMs: OPEN_TIMEOUT_MS });
	} catch (error) {
		if (options.platform === "android") {
			// Android ids may be AVD names rather than adb serials — try a boot by name.
			try {
				await runArgentTool(
					"boot-device",
					{ avdName: options.deviceId },
					{ timeoutMs: OPEN_TIMEOUT_MS },
				);
				await runArgentTool(
					"launch-app",
					{ udid, bundleId: target },
					{ timeoutMs: OPEN_TIMEOUT_MS },
				);
			} catch {
				throw error;
			}
		} else {
			throw error;
		}
	}

	const gate = new ActionGate();
	let sessionDeadNotified = false;
	let cachedWindow: { width: number; height: number } | null = null;
	const FRAME_CACHE_TTL_MS = 150;
	let frameCache: { at: number; frame: CapturedFrame } | null = null;
	let frameInFlight: Promise<CapturedFrame> | null = null;
	let lastApp: string | null = target;

	const notifySessionDead = () => {
		if (sessionDeadNotified) return;
		sessionDeadNotified = true;
		options.onSessionDead?.();
	};

	const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn();
		} catch (error) {
			if (isDeadSessionError(error)) {
				notifySessionDead();
				if (!(error instanceof DeadSessionError)) {
					const message = error instanceof Error ? error.message : String(error);
					throw new DeadSessionError(message);
				}
			}
			throw error;
		}
	};

	const windowNow = (): { width: number; height: number } =>
		cachedWindow ?? defaultWindowFor(options.platform);

	/** Visual-first: screenshot is the primary read; the tree is secondary. */
	const runScreenshot = async (scale?: number): Promise<{ base64: string }> => {
		const path = join(tmpdir(), `yoqa-shot-${Date.now()}-${crypto.randomUUID()}.png`);
		const params: Record<string, unknown> = { udid, out: path };
		if (scale != null) params.scale = scale;
		try {
			const result = (await runArgentTool("screenshot", params, {
				timeoutMs: 60_000,
			})) as { image?: string; path?: string } | string;
			if (typeof result === "object" && result && typeof result.image === "string") {
				const bytes = Buffer.from(result.image, "base64");
				const dims = pngDimensions(new Uint8Array(bytes));
				if (dims) cachedWindow = dims;
				await rm(path, { force: true }).catch(() => undefined);
				return { base64: result.image };
			}
			const filePath = typeof result === "object" && result?.path ? String(result.path) : path;
			const { base64, bytes } = await readImageFile(filePath);
			const dims = pngDimensions(bytes);
			if (dims) cachedWindow = dims;
			if (filePath === path) await rm(path, { force: true }).catch(() => undefined);
			return { base64 };
		} catch (error) {
			await rm(path, { force: true }).catch(() => undefined);
			throw error;
		}
	};

	const snapshotNodes = async (): Promise<{
		nodes: SnapshotNode[];
		window: { width: number; height: number };
	}> =>
		guard(async () => {
			const payload = (await runArgentTool("describe", { udid }, { timeoutMs: 60_000 })) as
				| DescribePayload
				| string;
			const parsed: DescribePayload =
				typeof payload === "string" ? { description: payload } : (payload ?? {});
			const window = windowNow();
			const nodes = parseDescribeToNodes(parsed, window);
			return { nodes, window };
		});

	const getWindowSize = async (): Promise<{ width: number; height: number }> => {
		if (cachedWindow) return cachedWindow;
		// One screenshot warms dimensions; fall back to platform default.
		try {
			await runScreenshot();
			if (cachedWindow) return cachedWindow;
		} catch {
			// ignore — default below
		}
		return defaultWindowFor(options.platform);
	};

	const owned: { current: DeviceSession | null } = { current: null };

	const quit = async () => {
		if (openByDeviceId.get(options.deviceId) === owned.current) {
			openByDeviceId.delete(options.deviceId);
		}
		gate.cancel();
		sessionDeadNotified = true;
		// Transport is shared per device — leave the Argent server running so
		// the next connect is fast. No named session to close.
	};

	const captureFrame = async (frameOptions?: { fresh?: boolean }): Promise<CapturedFrame> =>
		guard(async () => {
			const now = Date.now();
			if (!frameOptions?.fresh && frameCache && now - frameCache.at < FRAME_CACHE_TTL_MS) {
				return frameCache.frame;
			}
			if (frameInFlight) return frameInFlight;
			frameInFlight = (async (): Promise<CapturedFrame> => {
				const { base64 } = await runScreenshot(0.25);
				return { base64, mime: "image/png" as const };
			})();
			try {
				const frame = await frameInFlight;
				frameCache = { at: Date.now(), frame };
				return frame;
			} finally {
				frameInFlight = null;
			}
		});

	const screenshot = async (): Promise<{ path: string; base64: string }> => {
		await mkdir(SCREENSHOT_DIR, { recursive: true });
		const path = join(SCREENSHOT_DIR, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
		const { base64 } = await guard(async () => runScreenshot(1.0));
		await Bun.write(path, Buffer.from(base64, "base64"));
		return { path, base64 };
	};

	const tap = async (xNorm: number, yNorm: number, tapOptions?: { durationMs?: number }) => {
		const holdMs = tapOptions?.durationMs;
		await gate.withLock(async () => {
			await guard(async () => {
				if (holdMs != null && holdMs >= 400) {
					await runArgentTool(
						"gesture-custom",
						{
							udid,
							events: [
								{ type: "Down", x: toFrac(xNorm), y: toFrac(yNorm) },
								{ type: "Up", x: toFrac(xNorm), y: toFrac(yNorm), delayMs: Math.min(5000, holdMs) },
							],
						},
						{ timeoutMs: 60_000 },
					);
					return;
				}
				const params: Record<string, unknown> = {
					udid,
					x: toFrac(xNorm),
					y: toFrac(yNorm),
				};
				if (holdMs != null && holdMs > 50) {
					// No hold flag on gesture-tap — emulate with a custom press.
					await runArgentTool(
						"gesture-custom",
						{
							udid,
							events: [
								{ type: "Down", x: toFrac(xNorm), y: toFrac(yNorm) },
								{ type: "Up", x: toFrac(xNorm), y: toFrac(yNorm), delayMs: Math.min(2000, holdMs) },
							],
						},
						{ timeoutMs: 60_000 },
					);
					return;
				}
				await runArgentTool("gesture-tap", params, { timeoutMs: 60_000 });
			});
		});
	};

	const swipe = async (x1: number, y1: number, x2: number, y2: number, durationMs = 400) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool(
					"gesture-swipe",
					{
						udid,
						fromX: toFrac(x1),
						fromY: toFrac(y1),
						toX: toFrac(x2),
						toY: toFrac(y2),
						durationMs: Math.min(10000, Math.max(32, durationMs)),
					},
					{ timeoutMs: 60_000 },
				);
			});
		});
	};

	const drag = async (x1: number, y1: number, x2: number, y2: number, durationMs = 800) => {
		await gate.withLock(async () => {
			await guard(async () => {
				try {
					await runArgentTool(
						"gesture-swipe",
						{
							udid,
							fromX: toFrac(x1),
							fromY: toFrac(y1),
							toX: toFrac(x2),
							toY: toFrac(y2),
							durationMs: Math.min(10000, Math.max(150, durationMs)),
							momentum: false,
						},
						{ timeoutMs: 60_000 },
					);
				} catch {
					await runArgentTool(
						"gesture-custom",
						{
							udid,
							events: [
								{ type: "Down", x: toFrac(x1), y: toFrac(y1) },
								{ type: "Move", x: toFrac(x2), y: toFrac(y2), delayMs: durationMs },
								{ type: "Up", x: toFrac(x2), y: toFrac(y2) },
							],
						},
						{ timeoutMs: 60_000 },
					);
				}
			});
		});
	};

	const type = async (text: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool("keyboard", { udid, text }, { timeoutMs: 60_000 });
			});
		});
	};

	const activateApp = async (appId: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool(
					"launch-app",
					{ udid, bundleId: appId },
					{ timeoutMs: OPEN_TIMEOUT_MS },
				);
				lastApp = appId;
			});
		});
	};

	const terminateApp = async (appId: string) => {
		// Argent has no terminate tool — background via home; restart-app
		// covers the clean-state path and openUrl/launch covers foreground.
		await gate.withLock(async () => {
			await guard(async () => {
				try {
					await runArgentTool("button", { udid, button: "home" }, { timeoutMs: 60_000 });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`terminate ${appId} unsupported on this target: ${message}`);
				}
				if (lastApp === appId) lastApp = null;
			});
		});
	};

	const backgroundApp = async (seconds = 3) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool("button", { udid, button: "home" }, { timeoutMs: 60_000 });
			});
		});
		await Bun.sleep(Math.min(30_000, Math.max(0, seconds * 1000)));
		if (lastApp) {
			try {
				await guard(async () => {
					await runArgentTool(
						"launch-app",
						{ udid, bundleId: lastApp as string },
						{ timeoutMs: OPEN_TIMEOUT_MS },
					);
				});
			} catch (error) {
				console.warn(
					"[yoqa-runner] re-foreground after background failed:",
					error instanceof Error ? error.message : error,
				);
			}
		}
	};

	const openUrl = async (url: string) => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool("open-url", { udid, url }, { timeoutMs: OPEN_TIMEOUT_MS });
			});
		});
	};

	const tapAlertButton = async (wanted: RegExp): Promise<void> => {
		const { nodes } = await snapshotNodes();
		const match =
			nodes.find((n) => wanted.test(n.label ?? "")) ??
			nodes.find((n) => /ok|allow|accept|yes|confirm|done/i.test(n.label ?? ""));
		if (!match?.rect) {
			throw new Error("No alert button found — dismiss the dialog by hand and retry");
		}
		const window = windowNow();
		const cx = ((match.rect.x + match.rect.width / 2) / window.width) * 1000;
		const cy = ((match.rect.y + match.rect.height / 2) / window.height) * 1000;
		await tap(cx, cy);
	};

	const acceptAlert = async () => {
		await tapAlertButton(/accept|allow|ok|yes|confirm|done/i);
	};

	const dismissAlert = async () => {
		try {
			await tapAlertButton(/dismiss|cancel|deny|no|not now|later/i);
		} catch {
			await tapAlertButton(/accept|allow|ok|yes|confirm|done/i);
		}
	};

	const back = async () => {
		await gate.withLock(async () => {
			await guard(async () => {
				try {
					await runArgentTool("button", { udid, button: "back" }, { timeoutMs: 60_000 });
				} catch {
					// iOS has no back button — edge swipe instead.
					await runArgentTool(
						"gesture-swipe",
						{ udid, fromX: 0, fromY: 0.5, toX: 0.3, toY: 0.5, durationMs: 300 },
						{ timeoutMs: 60_000 },
					);
				}
			});
		});
	};

	const scroll = async (direction: "up" | "down" | "left" | "right", amount?: number) => {
		const frac = Math.min(0.8, Math.max(0.1, amount ?? 0.5));
		const center = 0.5;
		const half = frac / 2;
		const vectors = {
			up: { fromX: center, fromY: center + half, toX: center, toY: center - half },
			down: { fromX: center, fromY: center - half, toX: center, toY: center + half },
			left: { fromX: center + half, fromY: center, toX: center - half, toY: center },
			right: { fromX: center - half, fromY: center, toX: center + half, toY: center },
		}[direction];
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool(
					"gesture-swipe",
					{ udid, ...vectors, durationMs: 300, momentum: false },
					{ timeoutMs: 60_000 },
				);
			});
		});
	};

	const home = async () => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool("button", { udid, button: "home" }, { timeoutMs: 60_000 });
			});
		});
	};

	const keyboard = async (action: "dismiss" | "enter") => {
		await gate.withLock(async () => {
			await guard(async () => {
				await runArgentTool(
					"keyboard",
					action === "enter" ? { udid, key: "enter" } : { udid, key: "escape" },
					{ timeoutMs: 60_000 },
				);
			});
		});
	};

	const pointerEvent = async (
		phase: PointerPhase,
		xNorm: number,
		yNorm: number,
		seq: number,
	): Promise<void> => {
		void seq;
		const x = toFrac(xNorm);
		const y = toFrac(yNorm);
		if (phase === "begin") {
			gate.begin(xNorm, yNorm);
			return;
		}
		if (phase === "move") {
			gate.move(xNorm, yNorm);
			return;
		}
		const gesture = gate.take();
		if (!gesture) throw new Error("No active pointer — send begin before move/end");
		const total = Math.hypot(xNorm - gesture.startX, yNorm - gesture.startY);
		await guard(async () => {
			if (total < 12) {
				await runArgentTool("gesture-tap", { udid, x, y }, { timeoutMs: 60_000 });
			} else {
				await runArgentTool(
					"gesture-swipe",
					{
						udid,
						fromX: toFrac(gesture.startX),
						fromY: toFrac(gesture.startY),
						toX: x,
						toY: y,
						durationMs: 300,
					},
					{ timeoutMs: 60_000 },
				);
			}
		});
	};

	const session: DeviceSession = {
		quit,
		captureFrame,
		screenshot,
		snapshotNodes,
		getWindowSize,
		tap,
		swipe,
		drag,
		type,
		activateApp,
		terminateApp,
		backgroundApp,
		openUrl,
		acceptAlert,
		dismissAlert,
		back,
		scroll,
		home,
		keyboard,
		withActionLock: <T>(fn: () => Promise<T>) => gate.withLock(fn),
		pointerEvent,
		isPointerActive: () => gate.isPointerActive(),
	};
	owned.current = session;

	// Warm dimensions so first taps don't pay for discovery.
	try {
		await runScreenshot(0.25).catch(() => undefined);
	} catch {
		// Session is open; failures surface on first use.
	}

	openByDeviceId.set(options.deviceId, session);
	return session;
}

export type { ArgentError };
