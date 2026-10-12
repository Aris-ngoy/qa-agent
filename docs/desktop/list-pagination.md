# List pagination (Runs and Test cases)

## Goal

Stop the Runs list and the Test cases list from rendering every row at once. Show 20 rows a page by default, and never fewer than 20.

## Plan summary

- **Paginate in the client.** Both pages already load the app's whole list (`listRuns`, `listCases`), and their filters and the Test cases "select all filtered" checkbox work on that full list. Slicing what is on screen keeps those working unchanged.
- **One shared seam.** `paginate(items, page, pageSize)` and `pageFor(stored, key)` are pure functions with unit tests. `usePagination(items, resetKey)` holds the page and the page size, and `<Pager pagination={…}>` renders the footer. Both list pages use all of them.
- **Clamp the page instead of showing an empty one, and store the clamped value.** If a delete, a filter, or a live poll shrinks the list, the page moves back to the last page that still exists. If the list then grows again, the page does not jump forward to where it was.
- **Go back to page 1 automatically.** Each page passes a reset key made of the app id and the filter, so changing either one, or the page size, goes back to page 1. Filter controls do not have to remember to call a reset themselves.
- **Show the paging controls only when needed.** The "Showing X–Y of N" line appears whenever the list has rows. The rows-per-page select (HeroUI `Select`, like the other dropdowns) and Previous/Next appear only once there are more than 20 rows.
- Rejected: runner-side `limit`/`offset`. The client would need a total count and server-side filters, which is a bigger change than these list sizes call for.

## What shipped

- [`app/pagination/paginate.ts`](../../apps/desktop/src/mainview/app/pagination/paginate.ts) defines `PAGE_SIZES` (20 / 50 / 100), the `PageSize` type, `DEFAULT_PAGE_SIZE` (20), `paginate`, `pageFor`, and `formatPageRange` ("21–40 of 57").
- [`app/pagination/use-pagination.ts`](../../apps/desktop/src/mainview/app/pagination/use-pagination.ts) adds the `usePagination` hook.
- [`app/pagination/pager.tsx`](../../apps/desktop/src/mainview/app/pagination/pager.tsx) adds the `<Pager>` footer, which shows the visible range, a "Rows per page" select, and Previous/Next buttons with "Page N of M".
- [Runs list](../../apps/desktop/src/mainview/features/runs/list-page.tsx) pages the filtered runs. Changing the All/Passed/Failed filter or the app goes back to page 1.
- [Test cases list](../../apps/desktop/src/mainview/features/test-cases/list-page.tsx) pages the filtered cases. Typing in the filter box or switching apps goes back to page 1. The old "Showing 1-N of M" footer is now `<Pager>`, and its total counts the filtered cases rather than every case. "Select all filtered" still selects every filtered case, including ones on other pages.

## How to verify

1. Run `bun test apps/desktop/src/mainview/app/pagination`.
2. With more than 20 runs, open **Runs**. It shows rows 1–20 and "Page 1 of N", and Next moves to the following rows. Pick 50 under "Rows per page" and you are back on page 1 with up to 50 rows.
3. On the last page, delete its only run. The list moves to the new last page instead of showing nothing.
4. On **Test cases**, type in the filter box while on page 2. It goes back to page 1, and the footer counts only the matching cases.

## Known behaviour

- New runs arrive at the top of the list while it polls every 2 s. On page 2 or later, rows shift down by one page position each time a run is added. This is how offset paging over a live list behaves.

## Follow-ups

- Remember the chosen page size per list (for example in [UI preferences](./ui-preferences.md)) if users ask for it.
