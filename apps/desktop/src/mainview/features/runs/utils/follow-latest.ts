/** How far from the end still counts as "at the bottom", so a small scroll jitter keeps following. */
const FOLLOW_THRESHOLD_PX = 48;

export function isNearBottom(
	metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
	threshold: number = FOLLOW_THRESHOLD_PX,
): boolean {
	return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold;
}
