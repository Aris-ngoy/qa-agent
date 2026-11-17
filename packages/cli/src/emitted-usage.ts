/**
 * **Emitted usage**: Yoqa's own estimate of what the Agent output it wrote cost a calling agent's
 * context window. Not **Call usage** — that is what a Provider reports for one Decide or verify
 * call, and the two are never summed.
 *
 * Everything here is pure, so the numbers are reviewable without a provider, a device or a clock.
 */

import { envFlagEnabled, envWholeNumber } from "./env";

/**
 * Characters to a token. An estimate, not a count: it approximates the ~4-characters-per-token
 * rule of thumb that Anthropic's and OpenAI's own tokenizer guidance gives for English prose, and
 * it is deliberately not provider-specific — no tokenizer is loaded and no model is consulted.
 * A tree listing of coordinates tokenizes worse than prose and a URL worse still, so treat the
 * result as an order of magnitude for deciding when to delegate or compact, never as a bill.
 *
 * The largest known error is script, not content: CJK and Cyrillic run closer to one token per
 * character, so a localized app's tree can cost several times what this reports. Accepted rather
 * than corrected — a script-aware divisor would still be a guess, and the figure answers "am I
 * near the budget", which an understatement on one screen does not change. Measured against a
 * real page: a four-language tree reported 262 tokens.
 */
const CHARS_PER_TOKEN = 4;

/** Estimated tokens for text Yoqa wrote to stdout. Empty text costs nothing. */
export function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Pixels to a token for an Agent image. An estimate on the same footing as the text divisor: it
 * approximates the `width × height / 750` rule Anthropic publishes for image input, and is
 * deliberately not provider-specific — a provider that tiles images, or resizes before counting,
 * will disagree, and that is accepted.
 */
const IMAGE_PIXELS_PER_TOKEN = 750;

/** The pixel size of an Agent image Yoqa named in its output. */
export type EmittedImage = { width: number; height: number };

/**
 * Estimated tokens for an Agent image a command named by path. The cost lands on the calling
 * agent the moment it reads the file, which is why Yoqa counts it at the point it names it.
 * No image, or dimensions that could not be read, costs nothing — a guess here would be worse
 * than a gap.
 */
export function estimateImageTokens(image: EmittedImage | undefined): number {
	if (!image) return 0;
	const { width, height } = image;
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
	return Math.ceil((width * height) / IMAGE_PIXELS_PER_TOKEN);
}

/**
 * **Output budget**: the token figure a Device Session's Emitted usage is reported against.
 *
 * 250k is a product convention, not a model fact — common agent windows sit around and above it,
 * and a 1M-window model makes it conservative, which is why it is overridable. It is a warning
 * line and never a wall: no command is refused, delayed or truncated on account of the total.
 */
export const DEFAULT_OUTPUT_BUDGET = 250_000;

/** The budget in force, from `YOQA_OUTPUT_BUDGET`. An unusable value leaves the default alone. */
export function resolveOutputBudget(env: Record<string, string | undefined> = process.env): number {
	return envWholeNumber(env.YOQA_OUTPUT_BUDGET, DEFAULT_OUTPUT_BUDGET);
}

/** One command's share of a Device Session's total. */
export type EmittedUsageCommand = { command: string; tokens: number; calls: number };

/** What one Device Session has emitted so far. */
export type EmittedUsage = {
	session: string;
	total: number;
	/** Dearest command first, so the expensive one is the one an engineer reads. */
	byCommand: EmittedUsageCommand[];
};

function groupDigits(value: number): string {
	return value.toLocaleString("en-US");
}

/**
 * A running total against its budget: `203,418 of 250,000 tokens (81%)`.
 *
 * Shared by the report and the warning so the two cannot describe the same session differently.
 * A share over 100% is shown as-is, because the budget never blocks.
 */
function tokensOfBudget(total: number, budget: number): string {
	const share = Math.round((total / budget) * 100);
	return `${groupDigits(total)} of ${groupDigits(budget)} tokens (${share}%)`;
}

/**
 * The running total, the budget, the share of the window it has taken, and which commands took
 * it. Deliberately plain: this is read by an agent deciding whether to delegate or compact as
 * often as by a person, and a share over 100% is shown as-is because the budget never blocks.
 */
export function formatEmittedUsage(
	usage: EmittedUsage | null,
	options: { budget: number },
): string {
	if (!usage) return "No active Device Session, so nothing is being accounted.";

	const lines = [
		`Emitted ${tokensOfBudget(usage.total, options.budget)} — Device Session ${usage.session}`,
	];
	if (usage.byCommand.length === 0) {
		lines.push("Nothing emitted for this Device Session yet.");
		return lines.join("\n");
	}

	const width = Math.max(...usage.byCommand.map((entry) => entry.command.length));
	for (const entry of usage.byCommand) {
		const calls = entry.calls === 1 ? "1 call" : `${entry.calls} calls`;
		lines.push(`  ${entry.command.padEnd(width)}   ${groupDigits(entry.tokens)} (${calls})`);
	}
	return lines.join("\n");
}

/**
 * The Device Session an emission is accounted to: `<deviceId>@<connectedAt>`.
 *
 * The runner publishes no session id, but at most one Device Session exists per device id at a
 * time and `connectedAt` is stamped at connect and kept across a retarget — so this is stable for
 * a session's whole life and different for the next one, which is exactly what the running total
 * needs to reset on a fresh connect.
 */
export function deviceSessionId(session: { deviceId: string; connectedAt: number }): string {
	return `${session.deviceId}@${session.connectedAt}`;
}

/**
 * The high-water mark, as a percent of the budget. 80% leaves a fifth of the window to act in,
 * which is what makes the warning useful: a line that arrives at 99% has nothing left to buy.
 */
export const DEFAULT_WARN_AT_PERCENT = 80;

/** The threshold in force, from `YOQA_OUTPUT_WARN_AT`. An unusable value leaves the default alone. */
export function resolveWarnAtPercent(
	env: Record<string, string | undefined> = process.env,
): number {
	return envWholeNumber(env.YOQA_OUTPUT_WARN_AT, DEFAULT_WARN_AT_PERCENT);
}

/**
 * Whether `YOQA_NO_OUTPUT_WARNING` turns the line off. For CI and other non-interactive runs,
 * where nobody is there to delegate or compact and the line is only noise in a log.
 */
export function outputWarningSuppressed(
	env: Record<string, string | undefined> = process.env,
): boolean {
	return envFlagEnabled(env.YOQA_NO_OUTPUT_WARNING);
}

/**
 * Which band a running total sits in: 0 below the high-water mark, then one per budget's worth
 * above it.
 *
 * The marks are the high-water mark and then every further whole budget — 200k, 250k, 500k on the
 * defaults. Multiples of the high-water mark alone would put the second mark at 160% of the
 * budget, leaving a session that used up the very window it was warned about with nothing said,
 * which is the one crossing nobody should miss.
 */
function budgetBand(total: number, options: OutputBudgetThreshold): number {
	const mark = (options.budget * options.warnAtPercent) / 100;
	if (!(mark > 0) || !(options.budget > 0)) return 0;
	if (total < mark) return 0;
	return 1 + Math.floor(total / options.budget);
}

/** The budget a total is measured against, and the share of it that earns the first warning. */
export type OutputBudgetThreshold = { budget: number; warnAtPercent: number };

/**
 * The one stderr line for a command that pushed a Device Session past a high-water mark, or null
 * for one that did not.
 *
 * A crossing is derived from the two totals rather than remembered, which is why nothing here
 * keeps state: the ledger is append-only, so the total before a command is the total after it
 * minus what it emitted, and "has this already been warned about" is simply "were both totals in
 * the same band". A command that skips a mark outright still warns, because its band still rose.
 */
export function budgetWarning(
	totals: { before: number; after: number } & OutputBudgetThreshold,
): string | null {
	if (budgetBand(totals.after, totals) <= budgetBand(totals.before, totals)) return null;
	return `Yoqa has emitted ${tokensOfBudget(totals.after, totals.budget)} into this context — delegate further exploration to a sub-agent, or compact.`;
}
