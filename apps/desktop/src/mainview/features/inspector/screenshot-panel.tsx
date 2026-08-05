import type { SnippetContext } from "@/features/inspector/command-snippets";
import { ElementActionMenu } from "@/features/inspector/element-action-menu";
import { type InspectorSelection, hitTestElements } from "@/features/inspector/selection";
import type { ScreenElement } from "@yoqa/runner-client";
import { type MouseEvent, type PointerEvent, useCallback, useRef } from "react";

function isSameSelection(a: InspectorSelection, b: InspectorSelection): boolean {
	const aId = a.element?.id?.trim() ?? "";
	const bId = b.element?.id?.trim() ?? "";
	const aLabel = a.element?.label?.trim() ?? "";
	const bLabel = b.element?.label?.trim() ?? "";
	if (aId || bId || aLabel || bLabel) {
		return aId === bId && aLabel === bLabel && a.x === b.x && a.y === b.y;
	}
	return a.x === b.x && a.y === b.y;
}

type ScreenshotPanelProps = {
	imageUrl: string | null;
	elements: ScreenElement[];
	selection: InspectorSelection | null;
	/** Initial connect / first frame only — not every live poll. */
	loading: boolean;
	live: boolean;
	feedMode: "mjpeg" | "poll" | null;
	liveControl: boolean;
	onLiveControlChange: (enabled: boolean) => void;
	disabled: boolean;
	snippetContext: SnippetContext;
	onSelect: (selection: InspectorSelection) => void;
	/** Double-click records a tap for the hit element/point. */
	onDoubleTap: (selection: InspectorSelection) => void;
	onPointer: (phase: "begin" | "move" | "end", x: number, y: number) => void;
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
	feedMode,
	liveControl,
	onLiveControlChange,
	disabled,
	snippetContext,
	onSelect,
	onDoubleTap,
	onPointer,
	onInsertLines,
	onInsertAndRunLines,
	onCopyLines,
	onClearSelection,
}: ScreenshotPanelProps) {
	const imgRef = useRef<HTMLImageElement | null>(null);
	const pointerActiveRef = useRef(false);

	const coordsAtEvent = useCallback(
		(event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
			if (!imgRef.current) return null;
			const rect = imgRef.current.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return null;
			const x = Math.round(((event.clientX - rect.left) / rect.width) * 1000);
			const y = Math.round(((event.clientY - rect.top) / rect.height) * 1000);
			return {
				x: Math.min(1000, Math.max(0, x)),
				y: Math.min(1000, Math.max(0, y)),
			};
		},
		[],
	);

	const selectAtEvent = useCallback(
		(event: MouseEvent<HTMLElement>): InspectorSelection | null => {
			if (disabled || !imgRef.current) return null;
			const point = coordsAtEvent(event);
			if (!point) return null;
			const element = hitTestElements(elements, point.x, point.y);
			if (element) {
				return {
					x: Math.round(element.x + element.width / 2),
					y: Math.round(element.y + element.height / 2),
					element,
				};
			}
			return { x: point.x, y: point.y, element: null };
		},
		[coordsAtEvent, disabled, elements],
	);

	const handleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (liveControl) return;
			const next = selectAtEvent(event);
			if (!next) return;
			// Clicking the current selection again dismisses the action menu.
			if (selection && isSameSelection(selection, next)) {
				onClearSelection();
				return;
			}
			onSelect(next);
		},
		[liveControl, onClearSelection, onSelect, selectAtEvent, selection],
	);

	const handleDoubleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (liveControl) return;
			const next = selectAtEvent(event);
			if (next) onDoubleTap(next);
		},
		[liveControl, onDoubleTap, selectAtEvent],
	);

	const handlePointerDown = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (!liveControl || disabled) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			const point = coordsAtEvent(event);
			if (!point) return;
			pointerActiveRef.current = true;
			onClearSelection();
			onPointer("begin", point.x, point.y);
		},
		[coordsAtEvent, disabled, liveControl, onClearSelection, onPointer],
	);

	const handlePointerMove = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (!liveControl || !pointerActiveRef.current) return;
			const point = coordsAtEvent(event);
			if (!point) return;
			onPointer("move", point.x, point.y);
		},
		[coordsAtEvent, liveControl, onPointer],
	);

	const handlePointerUp = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (!liveControl || !pointerActiveRef.current) return;
			pointerActiveRef.current = false;
			const point = coordsAtEvent(event) ?? { x: 500, y: 500 };
			onPointer("end", point.x, point.y);
			try {
				event.currentTarget.releasePointerCapture(event.pointerId);
			} catch {
				/* already released */
			}
		},
		[coordsAtEvent, liveControl, onPointer],
	);

	const selectionAnchor = selection
		? {
				left: (selection.element?.x ?? Math.max(0, selection.x - 12)) / 10,
				top: (selection.element?.y ?? Math.max(0, selection.y - 12)) / 10,
				width: (selection.element?.width ?? 24) / 10,
				height: (selection.element?.height ?? 24) / 10,
			}
		: null;

	const liveLabel =
		feedMode === "poll" ? "Poll" : feedMode === "mjpeg" ? "Stream" : live ? "Live" : null;

	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<h2 className="text-title-sm font-semibold text-on-surface">Device</h2>
					{liveLabel ? (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-2 py-0.5 text-helper font-semibold text-on-secondary-container">
							<span className="relative flex size-1.5">
								<span className="absolute inline-flex size-full animate-ping rounded-full bg-secondary opacity-60" />
								<span className="relative inline-flex size-1.5 rounded-full bg-secondary" />
							</span>
							{liveLabel}
						</span>
					) : null}
					{live && !disabled ? (
						<label className="inline-flex cursor-pointer items-center gap-1.5 text-helper text-on-surface-variant">
							<input
								type="checkbox"
								className="size-3.5 accent-secondary"
								checked={liveControl}
								onChange={(event) => onLiveControlChange(event.target.checked)}
							/>
							Live control
						</label>
					) : null}
				</div>
				{liveControl ? (
					<span className="text-helper text-on-surface-variant">
						Drag on the screen to control the device
					</span>
				) : selection ? (
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

			<div className="relative flex min-h-56 items-center justify-center overflow-visible rounded-xl bg-surface-container p-3">
				{!imageUrl && !loading ? (
					<div className="flex min-h-56 flex-col items-center justify-center gap-2 px-6 text-center">
						<p className="text-body-sm font-medium text-on-surface">No live feed</p>
						<p className="max-w-xs text-helper text-on-surface-variant">
							Connect a device to stream the screen. Changes on the phone appear here automatically.
						</p>
					</div>
				) : null}

				{imageUrl ? (
					<div className="relative w-fit max-w-full overflow-visible">
						{/* biome-ignore lint/a11y/useKeyWithClickEvents: screenshot hit-testing is pointer-driven */}
						<div
							role="img"
							aria-label={
								liveControl
									? "Live device screen — drag to control"
									: "Live device screen — click to select actions, double-click to add tap"
							}
							className={[
								"relative block w-fit max-w-full touch-none",
								disabled
									? "cursor-not-allowed opacity-60"
									: liveControl
										? "cursor-grab active:cursor-grabbing"
										: "cursor-crosshair",
							].join(" ")}
							onClick={disabled ? undefined : handleClick}
							onDoubleClick={disabled ? undefined : handleDoubleClick}
							onPointerDown={disabled ? undefined : handlePointerDown}
							onPointerMove={disabled ? undefined : handlePointerMove}
							onPointerUp={disabled ? undefined : handlePointerUp}
							onPointerCancel={disabled ? undefined : handlePointerUp}
						>
							<img
								ref={imgRef}
								alt="Live device screenshot"
								className="pointer-events-none block max-h-[min(72vh,760px)] w-auto max-w-full rounded-lg shadow-[0_12px_40px_-18px_rgba(0,0,0,0.45)] select-none"
								draggable={false}
								src={imageUrl}
							/>
							{selection && selectionAnchor && !liveControl ? (
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
						{selection && selectionAnchor && !liveControl ? (
							<ElementActionMenu
								key={`${selection.x},${selection.y},${selection.element?.id ?? ""},${selection.element?.label ?? ""}`}
								selection={selection}
								anchor={selectionAnchor}
								disabled={disabled}
								snippetContext={snippetContext}
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
