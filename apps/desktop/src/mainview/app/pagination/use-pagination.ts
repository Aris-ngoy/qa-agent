import { batch } from "@legendapp/state";
import { useObservable, useValue } from "@legendapp/state/react";
import { useEffect } from "react";
import { DEFAULT_PAGE_SIZE, type PageSize, type StoredPage, pageFor, paginate } from "./paginate";

/**
 * Holds the page and page size for a fully loaded list. The page goes back
 * to 1 whenever `resetKey` changes (pass the filter, and the owning app),
 * and is stored clamped so a list that shrinks and then grows again does
 * not jump to a page the user never chose.
 */
export function usePagination<T>(items: readonly T[], resetKey: unknown) {
	const stored$ = useObservable<StoredPage>({ page: 1, key: resetKey });
	const pageSize$ = useObservable<PageSize>(DEFAULT_PAGE_SIZE);
	const stored = useValue(stored$);
	const pageSize = useValue(pageSize$);
	const slice = paginate(items, pageFor(stored, resetKey), pageSize);

	// Store the clamped page after render; this render already shows it.
	useEffect(() => {
		if (stored.page !== slice.page || !Object.is(stored.key, resetKey)) {
			stored$.set({ page: slice.page, key: resetKey });
		}
	}, [stored, slice.page, resetKey, stored$]);

	return {
		slice,
		pageSize,
		setPage: (page: number) => stored$.set({ page, key: resetKey }),
		setPageSize: (size: PageSize) => {
			batch(() => {
				pageSize$.set(size);
				stored$.set({ page: 1, key: resetKey });
			});
		},
	};
}

export type Pagination = ReturnType<typeof usePagination>;
