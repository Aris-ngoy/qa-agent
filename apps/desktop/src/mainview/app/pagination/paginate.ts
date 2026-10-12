/** Page sizes a list offers; the smallest is the default so a page never shows fewer than 20 rows. */
export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = PAGE_SIZES[0];

export type PageSlice<T> = {
	items: T[];
	/** 1-based page actually shown, clamped into range. */
	page: number;
	/** At least 1, so an empty list is one empty page. */
	pageCount: number;
	total: number;
	/** 1-based position of the first and last row shown; 0 when empty. */
	first: number;
	last: number;
};

/**
 * Cuts one page out of a fully loaded list. Clamps `page` instead of
 * returning an empty page, so a filter or delete that shrinks the list
 * never strands the user past the end.
 */
export function paginate<T>(items: readonly T[], page: number, pageSize: PageSize): PageSlice<T> {
	const total = items.length;
	const pageCount = Math.max(1, Math.ceil(total / pageSize));
	const current = Math.min(Math.max(1, Math.floor(page)), pageCount);
	const start = (current - 1) * pageSize;
	const slice = items.slice(start, start + pageSize);
	return {
		items: slice,
		page: current,
		pageCount,
		total,
		first: slice.length === 0 ? 0 : start + 1,
		last: start + slice.length,
	};
}

export function formatPageRange(slice: PageSlice<unknown>): string {
	if (slice.total === 0) return "0 of 0";
	return `${slice.first}–${slice.last} of ${slice.total}`;
}

/** A page remembered together with the filter (or other reset key) it belongs to. */
export type StoredPage = { page: number; key: unknown };

/** The page to show: the stored one, or page 1 once the reset key has moved on. */
export function pageFor(stored: StoredPage, key: unknown): number {
	return Object.is(stored.key, key) ? stored.page : 1;
}
