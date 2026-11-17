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
import type { EmittedUsage, EmittedUsageCommand } from "./emitted-usage";
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

/** One record as it sits on disk: what was emitted, and when. */
type LedgerLine = EmittedUsageRecord & { at: number };

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
async function readRecords(path: string): Promise<LedgerLine[]> {
	const text = await readFile(path, "utf8");
	const records: LedgerLine[] = [];
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
 * Append one command's emission and answer with the session's new running total, or null if the
 * ledger could not be written or read back.
 *
 * Never throws and never reports failure as an error: the command it accounts for has already
 * written its output, and a ledger problem must not change its exit code. The total comes back
 * because a crossing of the Output budget threshold is derived from it rather than remembered —
 * see `budgetWarning`. Null therefore means "no judgement available", not "zero".
 */
export async function appendEmittedUsage(
	record: EmittedUsageRecord,
	options: LedgerOptions = {},
): Promise<number | null> {
	const path = ledgerPath(options);
	const line = `${JSON.stringify({ ...record, at: (options.now ?? Date.now)() })}\n`;
	try {
		// The Yoqa home directory may not exist yet: the runner creates it, and the CLI can run first.
		await mkdir(dirname(path), { recursive: true });
		await appendFile(path, line, "utf8");
	} catch {
		return null;
	}

	let written: LedgerLine[];
	try {
		written = await readRecords(path);
	} catch {
		return null;
	}
	const mine = written.filter((entry) => entry.session === record.session);
	const total = mine.reduce((sum, entry) => sum + entry.tokens, 0);

	try {
		// Read once and reused: compaction keeps this session's records and drops every other.
		if ((await stat(path)).size > MAX_LEDGER_BYTES) {
			await writeFile(path, mine.map((entry) => `${JSON.stringify(entry)}\n`).join(""), "utf8");
		}
	} catch {
		// An over-long ledger is a disk problem, not a reason to fail a QA command.
	}
	return total;
}

/** What this Device Session has emitted. Zero for a session, or a ledger, that is not there. */
export async function readEmittedUsage(
	session: string,
	options: LedgerOptions = {},
): Promise<EmittedUsage> {
	let records: LedgerLine[] = [];
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
