/**
 * The Emitted usage ledger: an append-only record of what each `yoqa` command put into a calling
 * agent's context window, keyed by Device Session.
 *
 * It lives on the CLI side rather than in the runner for two reasons. Each CLI process is
 * short-lived, so a running total cannot sit in memory; and the runner cannot know whether the CLI
 * printed compact JSON or a formatted tree, so only the CLI knows what was actually emitted.
 *
 * Everything here is best-effort by construction. A missing, corrupt or unwritable ledger reads as
 * zero and writes as a no-op — accounting must never be able to break a QA session.
 */

import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { yoqaRoot } from "./ensure-runner";

/** One command's emission, as the output seam records it. */
export type EmittedUsageRecord = {
	/** The Device Session the emission belongs to. */
	session: string;
	/** The command as a caller typed it, e.g. `screen` or `action tap`. */
	command: string;
	/** Estimated tokens, from the pure estimator. */
	tokens: number;
};

/** One command's share of a session's total. */
export type EmittedUsageCommand = { command: string; tokens: number; calls: number };

/** What one Device Session has emitted so far. */
export type EmittedUsage = {
	session: string;
	total: number;
	/** Dearest command first, so the expensive one is the one an engineer reads. */
	byCommand: EmittedUsageCommand[];
};

/**
 * Past this, an append rewrites the ledger with only the current session's records. Append-only in
 * a user's home directory would otherwise grow without bound, and every total Yoqa reports is
 * scoped to one session anyway. Best-effort like the rest of this module.
 */
export const MAX_LEDGER_BYTES = 1024 * 1024;

/**
 * Where the ledger lives. `YOQA_EMITTED_USAGE_PATH` overrides it, the way `YOQA_DB_PATH` overrides
 * the catalog database, so CI and tests can keep their accounting off a developer's own.
 */
export function emittedUsageLedgerPath(
	env: Record<string, string | undefined> = process.env,
): string {
	return env.YOQA_EMITTED_USAGE_PATH ?? join(yoqaRoot(homedir()), "emitted-usage.jsonl");
}

/** The injected clock and path these functions are tested over. */
export type LedgerOptions = { path?: string; now?: () => number };

function ledgerPath(options: LedgerOptions): string {
	return options.path ?? emittedUsageLedgerPath();
}

/** Records whose JSON parsed into the shape we wrote. A line that did not is simply dropped. */
async function readRecords(path: string): Promise<(EmittedUsageRecord & { at: number })[]> {
	const text = await readFile(path, "utf8");
	const records: (EmittedUsageRecord & { at: number })[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as Record<string, unknown>;
			if (typeof parsed.session !== "string" || typeof parsed.command !== "string") continue;
			if (typeof parsed.tokens !== "number" || !Number.isFinite(parsed.tokens)) continue;
			records.push({
				session: parsed.session,
				command: parsed.command,
				tokens: parsed.tokens,
				at: typeof parsed.at === "number" ? parsed.at : 0,
			});
		} catch {
			// A half-written or hand-edited line costs its own tokens, not the whole total.
		}
	}
	return records;
}

/**
 * Append one command's emission. Never throws and never reports failure: the command it accounts
 * for has already written its output, and a ledger problem must not change its exit code.
 */
export async function appendEmittedUsage(
	record: EmittedUsageRecord,
	options: LedgerOptions = {},
): Promise<void> {
	const path = ledgerPath(options);
	const line = `${JSON.stringify({ ...record, at: (options.now ?? Date.now)() })}\n`;
	try {
		// The Yoqa home directory may not exist yet: the runner creates it, and the CLI can run first.
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, line, "utf8");
	} catch {
		return;
	}
	try {
		if ((await stat(path)).size <= MAX_LEDGER_BYTES) return;
		const mine = await readRecords(path);
		const kept = mine.filter((entry) => entry.session === record.session);
		await writeFile(path, kept.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "utf8");
	} catch {
		// An over-long ledger is a disk problem, not a reason to fail a QA command.
	}
}

/** What this Device Session has emitted. Zero for a session, or a ledger, that is not there. */
export async function readEmittedUsage(
	session: string,
	options: LedgerOptions = {},
): Promise<EmittedUsage> {
	let records: (EmittedUsageRecord & { at: number })[] = [];
	try {
		records = (await readRecords(ledgerPath(options))).filter(
			(record) => record.session === session,
		);
	} catch {
		// No ledger yet, or one we cannot read: the honest answer is that nothing is accounted.
	}

	const byCommand = new Map<string, EmittedUsageCommand>();
	let total = 0;
	for (const record of records) {
		total += record.tokens;
		const entry = byCommand.get(record.command) ?? { command: record.command, tokens: 0, calls: 0 };
		entry.tokens += record.tokens;
		entry.calls += 1;
		byCommand.set(record.command, entry);
	}

	return {
		session,
		total,
		byCommand: [...byCommand.values()].sort((a, b) => b.tokens - a.tokens),
	};
}
