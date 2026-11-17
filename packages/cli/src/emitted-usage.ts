/**
 * **Emitted usage**: Yoqa's own estimate of what the Agent output it wrote cost a calling agent's
 * context window. Not **Call usage** — that is what a Provider reports for one Decide or verify
 * call, and the two are never summed.
 *
 * Everything here is pure, so the numbers are reviewable without a provider, a device or a clock.
 */

/**
 * Characters to a token. An estimate, not a count: it approximates the ~4-characters-per-token
 * rule of thumb that Anthropic's and OpenAI's own tokenizer guidance gives for English prose, and
 * it is deliberately not provider-specific — no tokenizer is loaded and no model is consulted.
 * A tree listing of coordinates tokenizes worse than prose and a URL worse still, so treat the
 * result as an order of magnitude for deciding when to delegate or compact, never as a bill.
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
	const budget = Number(env.YOQA_OUTPUT_BUDGET);
	if (!Number.isInteger(budget) || budget < 1) return DEFAULT_OUTPUT_BUDGET;
	return budget;
}

/** What `yoqa usage` reports: one Device Session's running total, or that there is no session. */
export type EmittedUsageReport = {
	/** The Device Session the total belongs to; null when none is connected. */
	session: string | null;
	total: number;
	byCommand: { command: string; tokens: number; calls: number }[];
};

function thousands(value: number): string {
	return value.toLocaleString("en-US");
}

/**
 * The running total, the budget, the share of the window it has taken, and which commands took
 * it. Deliberately plain: this is read by an agent deciding whether to delegate or compact as
 * often as by a person, and a share over 100% is shown as-is because the budget never blocks.
 */
export function formatEmittedUsage(
	report: EmittedUsageReport,
	options: { budget: number },
): string {
	if (report.session == null) return "No active Device Session, so nothing is being accounted.";

	const share = Math.round((report.total / options.budget) * 100);
	const lines = [
		`Emitted ${thousands(report.total)} of ${thousands(options.budget)} tokens (${share}%) — Device Session ${report.session}`,
	];
	if (report.byCommand.length === 0) {
		lines.push("Nothing emitted for this Device Session yet.");
		return lines.join("\n");
	}

	const width = Math.max(...report.byCommand.map((entry) => entry.command.length));
	for (const entry of report.byCommand) {
		const calls = entry.calls === 1 ? "1 call" : `${entry.calls} calls`;
		lines.push(`  ${entry.command.padEnd(width)}   ${thousands(entry.tokens)} (${calls})`);
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
