import { ListBox, Select } from "@heroui/react";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageSize, formatPageRange } from "./paginate";
import type { Pagination } from "./use-pagination";

function PageButton({
	label,
	disabled,
	onPress,
	path,
}: {
	label: string;
	disabled: boolean;
	onPress: () => void;
	path: string;
}) {
	return (
		<button
			aria-label={label}
			className="flex size-8 items-center justify-center rounded-[var(--radius)] text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:bg-hover-surface hover:text-on-surface disabled:pointer-events-none disabled:opacity-40"
			disabled={disabled}
			onClick={onPress}
			type="button"
		>
			<svg
				aria-hidden="true"
				className="size-4"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
				viewBox="0 0 24 24"
			>
				<path d={path} />
			</svg>
		</button>
	);
}

/**
 * Footer for a paginated list: the rows on screen, rows per page, and
 * previous/next. The paging controls appear only once the list outgrows
 * one smallest page; an empty list renders nothing.
 */
export function Pager({
	pagination,
	noun,
	className = "",
}: {
	pagination: Pagination;
	/** Plural name of the rows, e.g. "runs". */
	noun: string;
	className?: string;
}) {
	const { slice, pageSize, setPage, setPageSize } = pagination;
	if (slice.total === 0) return null;

	return (
		<nav
			aria-label={`${noun} pages`}
			className={[
				"flex flex-wrap items-center justify-between gap-3 text-body-sm text-on-surface-variant",
				className,
			].join(" ")}
		>
			<span>
				Showing {formatPageRange(slice)} {noun}
			</span>
			{slice.total > DEFAULT_PAGE_SIZE ? (
				<div className="flex items-center gap-4">
					<div className="flex items-center gap-2">
						<span aria-hidden="true">Rows per page</span>
						<Select
							aria-label="Rows per page"
							onSelectionChange={(key) => {
								if (key != null) setPageSize(Number(key) as PageSize);
							}}
							selectedKey={String(pageSize)}
						>
							<Select.Trigger className="h-8 min-w-[4.5rem] items-center rounded-[var(--radius)] border border-outline-variant bg-surface-container-lowest px-2.5 shadow-none">
								<Select.Value />
								<Select.Indicator className="text-on-surface-variant" />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{PAGE_SIZES.map((size) => (
										<ListBox.Item id={String(size)} key={size} textValue={String(size)}>
											{size}
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					</div>
					<div className="flex items-center gap-1">
						<PageButton
							disabled={slice.page <= 1}
							label="Previous page"
							onPress={() => setPage(slice.page - 1)}
							path="M15 6l-6 6 6 6"
						/>
						<span aria-live="polite" className="min-w-[5.5rem] text-center tabular-nums">
							Page {slice.page} of {slice.pageCount}
						</span>
						<PageButton
							disabled={slice.page >= slice.pageCount}
							label="Next page"
							onPress={() => setPage(slice.page + 1)}
							path="M9 6l6 6-6 6"
						/>
					</div>
				</div>
			) : null}
		</nav>
	);
}
