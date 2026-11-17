/**
 * How the CLI reads its own environment.
 *
 * Two shapes cover every `YOQA_*` knob that is not a path: a whole number with a floor, and an
 * on/off flag. They live here so the CLI has one spelling of "unusable value" and one spelling of
 * "off" rather than one per knob — the knobs are read in several modules, and a knob that
 * disagreed with its neighbours about whether `yes` means yes would be a bug nobody would look for.
 */

/**
 * A whole number of 1 or more from an environment variable, or the default.
 *
 * Unset, fractional, negative, zero or not a number all leave the default alone, deliberately:
 * a knob the caller got wrong should behave like a knob they never touched, because guessing at
 * `YOQA_OUTPUT_BUDGET=1e6` or failing the command outright are both worse than the default they
 * already had.
 */
export function envWholeNumber(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) return fallback;
	return parsed;
}

/** Whether an environment flag is on. Unset is off, and `1`, `true` and `yes` are on. */
export function envFlagEnabled(value: string | undefined): boolean {
	const raw = value?.trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes";
}
