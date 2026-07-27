import { ElementActionMenu } from "@/features/inspector/element-action-menu";
import { type InspectorSelection, hitTestElements } from "@/features/inspector/selection";
import type { ScreenElement } from "@yoqa/runner-client";
import { type MouseEvent, useCallback, useRef } from "react";

type ScreenshotPanelProps = {
	imageUrl: string | null;
	elements: ScreenElement[];
	selection: InspectorSelection | null;
	/** Initial connect / first frame only — not every live poll. */
	loading: boolean;
	live: boolean;
	disabled: boolean;
	onSelect: (selection: InspectorSelection) => void;
	/** Double-click records a tap for the hit element/point. */
	onDoubleTap: (selection: InspectorSelection) => void;
	onInsertLines: (lines: string[]) => void;
	onInsertAndRunLines: (lines: string[]) => void;
	onCopyLines: (lines: string[]) => void;
	onClearSelection: () => void;
};

export function ScreenshotPanel({
	imageUrl,
	elements,
	selection,
	loading,
	live,
	disabled,
	onSelect,
	onDoubleTap,
	onInsertLines,
	onInsertAndRunLines,
	onCopyLines,
	onClearSelection,
}: ScreenshotPanelProps) {
	const imgRef = useRef<HTMLImageElement | null>(null);

	const selectAtEvent = useCallback(
		(event: MouseEvent<HTMLElement>): InspectorSelection | null => {
			if (disabled || !imgRef.current) return null;
			const rect = imgRef.current.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return null;
			const x = Math.round(((event.clientX - rect.left) / rect.width) * 1000);
			const y = Math.round(((event.clientY - rect.top) / rect.height) * 1000);
			const clampedX = Math.min(1000, Math.max(0, x));
			const clampedY = Math.min(1000, Math.max(0, y));
			const element = hitTestElements(elements, clampedX, clampedY);
			if (element) {
				return {
					x: Math.round(element.x + element.width / 2),
					y: Math.round(element.y + element.height / 2),
					element,
				};
			}
			return { x: clampedX, y: clampedY, element: null };
		},
		[disabled, elements],
	);

	const handleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			const next = selectAtEvent(event);
			if (next) onSelect(next);
		},
		[onSelect, selectAtEvent],
	);

	const handleDoubleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			const next = selectAtEvent(event);
			if (next) onDoubleTap(next);
		},
		[onDoubleTap, selectAtEvent],
	);

	const selectionAnchor = selection
		? {
				left: (selection.element?.x ?? Math.max(0, selection.x - 12)) / 10,
				top: (selection.element?.y ?? Math.max(0, selection.y - 12)) / 10,
				width: (selection.element?.width ?? 24) / 10,
				height: (selection.element?.height ?? 24) / 10,
			}
		: null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<h2 className="text-title-sm font-semibold text-on-surface">Device</h2>
					{live ? (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-2 py-0.5 text-helper font-semibold text-on-secondary-container">
							<span className="relative flex size-1.5">
								<span className="absolute inline-flex size-full animate-ping rounded-full bg-secondary opacity-60" />
								<span className="relative inline-flex size-1.5 rounded-full bg-secondary" />
							</span>
							Live
						</span>
					) : null}
				</div>
				{selection ? (
					<span className="max-w-[55%] truncate text-helper text-on-surface-variant">
						{selection.element?.id
							? `id ${selection.element.id}`
							: selection.element?.label || selection.element?.type || "point"}{" "}
						· {selection.x},{selection.y}
					</span>
				) : (
					<span className="text-helper text-on-surface-variant">
						Click element for actions · double-click to insert tap
					</span>
				)}
			</div>

			<div className="relative flex min-h-56 items-center justify-center rounded-xl bg-surface-container p-3">
				{!imageUrl && !loading ? (
					<div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center">
						<p className="text-body-sm font-medium text-on-surface">No live feed</p>
						<p className="max-w-xs text-helper text-on-surface-variant">
							Connect a device to stream the screen. Changes on the phone appear here automatically.
						</p>
					</div>
				) : null}

				{imageUrl ? (
					<div className="relative w-fit max-w-full">
						{/* biome-ignore lint/a11y/useKeyWithClickEvents: screenshot hit-testing is pointer-driven */}
						<div
							role="img"
							aria-label="Live device screen — click to select actions, double-click to add tap"
							className={[
								"relative block w-fit max-w-full",
								disabled ? "cursor-not-allowed opacity-60" : "cursor-crosshair",
							].join(" ")}
							onClick={disabled ? undefined : handleClick}
							onDoubleClick={disabled ? undefined : handleDoubleClick}
						>
							<img
								ref={imgRef}
								alt="Live device screenshot"
								className="pointer-events-none block max-h-[min(72vh,760px)] w-auto max-w-full rounded-lg shadow-[0_12px_40px_-18px_rgba(0,0,0,0.45)] select-none"
								draggable={false}
								src={imageUrl}
							/>
							{selection && selectionAnchor ? (
								<span
									aria-hidden="true"
									className="pointer-events-none absolute border-2 border-secondary bg-secondary/20"
									style={{
										left: `${selectionAnchor.left}%`,
										top: `${selectionAnchor.top}%`,
										width: `${selectionAnchor.width}%`,
										height: `${selectionAnchor.height}%`,
									}}
								/>
							) : null}
						</div>
						{selection && selectionAnchor ? (
							<ElementActionMenu
								key={`${selection.x},${selection.y},${selection.element?.id ?? ""},${selection.element?.label ?? ""}`}
								selection={selection}
								anchor={selectionAnchor}
								disabled={disabled}
								onInsert={onInsertLines}
								onInsertAndRun={onInsertAndRunLines}
								onCopyLines={onCopyLines}
								onClearSelection={onClearSelection}
							/>
						) : null}
					</div>
				) : null}

				{loading ? (
					<div className="absolute inset-0 flex items-center justify-center bg-surface/55 text-body-sm text-on-surface-variant backdrop-blur-[1px]">
						Starting live feed…
					</div>
				) : null}
			</div>
		</div>
	);
}
