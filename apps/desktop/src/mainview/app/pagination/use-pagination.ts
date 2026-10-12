import { useState } from "react";
import { DEFAULT_PAGE_SIZE, type PageSize, type StoredPage, pageFor, paginate } from "./paginate";

/**
 * Holds the page and page size for a fully loaded list. The page goes back
 * to 1 whenever `resetKey` changes (pass the filter, and the owning app),
 * and is stored clamped so a list that shrinks and then grows again does
 * not jump to a page the user never chose.
 */
export function usePagination<T>(items: readonly T[], resetKey: unknown) {
	const [stored, setStored] = useState<StoredPage>({ page: 1, key: resetKey });
	const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
	const slice = paginate(items, pageFor(stored, resetKey), pageSize);

	if (stored.page !== slice.page || !Object.is(stored.key, resetKey)) {
		setStored({ page: slice.page, key: resetKey });
	}

	return {
		slice,
		pageSize,
		setPage: (page: number) => setStored({ page, key: resetKey }),
		setPageSize: (size: PageSize) => {
			setPageSize(size);
			setStored({ page: 1, key: resetKey });
		},
	};
}

export type Pagination = ReturnType<typeof usePagination>;
