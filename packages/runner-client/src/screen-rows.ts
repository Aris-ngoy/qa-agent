/**
 * The row cap on a cleaned Screen listing, and the line a trimmed listing ends with.
 *
 * Shared because two surfaces bound the same tree: the Decide loop's screen snapshot and the
 * Agent output of `yoqa screen`. Declaring the cap twice would let them drift into disagreeing
 * about what a bounded tree is, so both import it from here.
 */

export const MAX_SCREEN_ROWS = 80;

/** Closes a trimmed listing with the count of what the cap left out. */
export function screenRowsOmittedLine(omitted: number): string {
	return `… ${omitted} more elements omitted`;
}
