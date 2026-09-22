import { runArgentTool } from "./cli";

/** Default `list-devices` timeout (listing a large device pool can be slow). */
const LIST_TIMEOUT_MS = 60_000;

/** One entry of `argent run list-devices` (all fields optional per backend). */
export type ArgentListEntry = {
	platform?: unknown;
	udid?: unknown;
	serial?: unknown;
	id?: unknown;
	name?: unknown;
	kind?: unknown;
	state?: unknown;
	runtime?: unknown;
	model?: unknown;
};

/** Trimmed non-empty string, or null. */
export function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Normalize `list-devices` output to object entries — accepts the documented
 * `{ devices: [...] }` envelope and tolerates a bare array. Non-object entries
 * are dropped.
 */
export function parseArgentListEntries(data: unknown): ArgentListEntry[] {
	const raw = (Array.isArray(data) ? data : (data as { devices?: unknown } | null)?.devices) ?? [];
	if (!Array.isArray(raw)) return [];
	return raw.filter(
		(entry): entry is ArgentListEntry => typeof entry === "object" && entry !== null,
	);
}

/** True when the entry identifies `deviceId` (udid / serial / id). */
export function matchesDeviceId(entry: ArgentListEntry, deviceId: string): boolean {
	return [entry.udid, entry.serial, entry.id].some(
		(candidate) => typeof candidate === "string" && candidate === deviceId,
	);
}

/** Run `argent run list-devices` and return its parsed entries. */
export async function listArgentEntries(
	options: { timeoutMs?: number } = {},
): Promise<ArgentListEntry[]> {
	const data = await runArgentTool("list-devices", [], {
		timeoutMs: options.timeoutMs ?? LIST_TIMEOUT_MS,
	});
	return parseArgentListEntries(data);
}
