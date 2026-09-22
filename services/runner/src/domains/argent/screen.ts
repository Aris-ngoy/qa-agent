/**
 * Argent screen bridge (parity-only).
 *
 * `argent run describe` returns `{ description, source }` where description
 * is header + lines like:
 *   AXStaticText "21:22"  (0.129, 0.026, 0.109, 0.023)
 *   AXTextField "wifi.rounded" id="wifi.rounded"  (...)
 *   AXGroup "Mobile Service" value="No signal"  (...)
 * Frames are 0–1 fractions. This module parses them onto the 0–1000 grid
 * so the stable `snapshotNodesToScreen` cleaner maps losslessly back.
 */

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CapturedFrame, SnapshotNode } from "../devices/session";
import { runArgentTool } from "./cli";

/** Argent snapshots live on the 0–1000 grid — the cleaner maps back 1:1. */
export const ARGENT_SNAPSHOT_WINDOW = { width: 1000, height: 1000 } as const;

/** Live-feed coalescing window — mirrors `domains/devices/session.ts`. */
const FRAME_CACHE_TTL_MS = 150;

const ROLE_RE = /^(AX[A-Za-z0-9_]*)\b\s*(.*)$/;
const LABEL_RE = /"([^"]*)"/;
const VALUE_RE = /\bvalue="([^"]*)"/;
const ID_RE = /\bid="([^"]*)"/;
const FRAME_RE =
	/\(\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)\s*,\s*([0-9.eE+-]+)\s*\)/;

function firstGroup(re: RegExp, text: string): string | undefined {
	const match = text.match(re);
	return match?.[1];
}

function toGrid(value: number): number {
	return Math.round(value * 1000);
}

/**
 * Parse `argent run describe` text into snapshot nodes on the 0–1000 grid.
 * Skips header/blank/unparseable lines (no AX role or no frame).
 * Zero-area entries are kept — `snapshotNodesToScreen` drops them.
 */
export function parseArgentDescribe(description: string): SnapshotNode[] {
	const nodes: SnapshotNode[] = [];
	const lines = description.split("\n");
	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) continue;
		const roleMatch = line.match(ROLE_RE);
		if (!roleMatch) continue;
		const role = roleMatch[1] as string;
		const rest = roleMatch[2] ?? "";
		const frameMatch = line.match(FRAME_RE);
		if (!frameMatch) continue;
		const fractions = frameMatch.slice(1, 5).map(Number);
		if (fractions.some((n) => !Number.isFinite(n))) continue;
		const [fx = 0, fy = 0, fw = 0, fh = 0] = fractions;
		const label = firstGroup(LABEL_RE, rest);
		const value = firstGroup(VALUE_RE, rest);
		const identifier = firstGroup(ID_RE, rest);
		nodes.push({
			ref: `argent-${nodes.length}`,
			type: role,
			role,
			...(label ? { label } : {}),
			...(value ? { value } : {}),
			...(identifier ? { identifier } : {}),
			rect: { x: toGrid(fx), y: toGrid(fy), width: toGrid(fw), height: toGrid(fh) },
		});
	}
	return nodes;
}

function describeTextFrom(data: unknown): string {
	if (typeof data === "string") return data;
	if (data && typeof data === "object") {
		const description = (data as { description?: unknown }).description;
		if (typeof description === "string") return description;
	}
	return "";
}

function screenshotPathFrom(data: unknown): string | null {
	if (typeof data === "string") return data || null;
	if (data && typeof data === "object") {
		const record = data as Record<string, unknown>;
		for (const key of ["image", "path", "imagePath", "screenshot"]) {
			const candidate = record[key];
			if (typeof candidate === "string" && candidate) return candidate;
		}
	}
	return null;
}

function screenshotDir(): string {
	return join(process.env.HOME ?? tmpdir(), ".yoqa", "runs", "screenshots");
}

const frameCache = new Map<string, { at: number; frame: CapturedFrame }>();
const frameInFlight = new Map<string, Promise<CapturedFrame>>();

/** Test-only: drop frame caches so tests start isolated. */
export function resetArgentScreenForTests(): void {
	frameCache.clear();
	frameInFlight.clear();
}

/** `argent run describe` parsed onto the 0–1000 window. */
export async function argentSnapshotNodes(
	deviceId: string,
): Promise<{ nodes: SnapshotNode[]; window: { width: number; height: number } }> {
	const data = await runArgentTool("describe", ["--udid", deviceId]);
	const nodes = parseArgentDescribe(describeTextFrom(data));
	return { nodes, window: { ...ARGENT_SNAPSHOT_WINDOW } };
}

/**
 * In-memory frame for live feed / grounding — never persists under runs/.
 * Within the TTL concurrent callers share one capture; pass
 * `{ fresh: true }` (stream pump) to always capture a new frame.
 */
export async function argentCaptureFrame(
	deviceId: string,
	options?: { fresh?: boolean },
): Promise<CapturedFrame> {
	const now = Date.now();
	const cached = frameCache.get(deviceId);
	if (!options?.fresh && cached && now - cached.at < FRAME_CACHE_TTL_MS) {
		return cached.frame;
	}
	const inFlight = frameInFlight.get(deviceId);
	if (inFlight) return inFlight;
	const pending = (async (): Promise<CapturedFrame> => {
		const data = await runArgentTool("screenshot", ["--udid", deviceId]);
		const imagePath = screenshotPathFrom(data);
		if (!imagePath) {
			throw new Error(`argent screenshot returned no image path for ${deviceId}`);
		}
		const bytes = await Bun.file(imagePath).arrayBuffer();
		return { base64: Buffer.from(bytes).toString("base64"), mime: "image/png" as const };
	})();
	frameInFlight.set(deviceId, pending);
	try {
		const frame = await pending;
		frameCache.set(deviceId, { at: Date.now(), frame });
		return frame;
	} finally {
		frameInFlight.delete(deviceId);
	}
}

/**
 * Persist a screenshot under `~/.yoqa/runs/screenshots/` and return its
 * path plus base64. Copies Argent's image file — never returns /tmp as the
 * persisted path.
 */
export async function argentScreenshot(
	deviceId: string,
): Promise<{ path: string; base64: string }> {
	const data = await runArgentTool("screenshot", ["--udid", deviceId]);
	const imagePath = screenshotPathFrom(data);
	if (!imagePath) {
		throw new Error(`argent screenshot returned no image path for ${deviceId}`);
	}
	const bytes = await Bun.file(imagePath).arrayBuffer();
	const dir = screenshotDir();
	await mkdir(dir, { recursive: true });
	const dest = join(dir, `shot_${Date.now()}_${crypto.randomUUID()}.png`);
	await Bun.write(dest, bytes);
	return { path: dest, base64: Buffer.from(bytes).toString("base64") };
}
