import type { SnippetContext } from "@/features/inspector/command-snippets";
import { ElementActionMenu } from "@/features/inspector/element-action-menu";
import {
	type InspectorSelection,
	activeSelectorCaption,
	hitTestElements,
	selectionFromPoint,
} from "@/features/inspector/selection";
import type { ScreenElement } from "@yoqa/runner-client";
import {
	type MouseEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

function isSameSelection(a: InspectorSelection, b: InspectorSelection): boolean {
	if (a.preferredLocator !== b.preferredLocator) return false;
	if (a.candidateIndex !== b.candidateIndex) return false;
	const aId = a.element?.id?.trim() ?? "";
	const bId = b.element?.id?.trim() ?? "";
	const aLabel = a.element?.label?.trim() ?? "";
	const bLabel = b.element?.label?.trim() ?? "";
	if (aId || bId || aLabel || bLabel) {
		return aId === bId && aLabel === bLabel && a.x === b.x && a.y === b.y;
	}
	return a.x === b.x && a.y === b.y;
}

function elementBoxPercent(element: ScreenElement): {
	left: number;
	top: number;
	width: number;
	height: number;
} {
	return {
		left: element.x / 10,
		top: element.y / 10,
		width: element.width / 10,
		height: element.height / 10,
	};
}

type ScreenshotPanelProps = {
	imageUrl: string | null;
	elements: ScreenElement[];
	selection: InspectorSelection | null;
	/** Initial connect / first frame only — not every live poll. */
	loading: boolean;
	/** True while warming / refreshing the accessibility tree. */
	treeRefreshing: boolean;
	live: boolean;
	feedMode: "mjpeg" | "poll" | null;
	liveControl: boolean;
	onLiveControlChange: (enabled: boolean) => void;
	disabled: boolean;
	snippetContext: SnippetContext;
	/** Optional: notify parent after a local select so it can background-refresh a stale tree. */
	onSelectWithPoint?: (selection: InspectorSelection) => void;
	onSelect: (selection: InspectorSelection) => void;
	onChangeSelector: () => void;
	onRefreshTree: () => void;
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
	treeRefreshing,
	live,
	feedMode,
	liveControl,
	onLiveControlChange,
	disabled,
	snippetContext,
	onSelectWithPoint,
	onSelect,
	onChangeSelector,
	onRefreshTree,
	onDoubleTap,
	onPointer,
	onInsertLines,
	onInsertAndRunLines,
	onCopyLines,
	onClearSelection,
}: ScreenshotPanelProps) {
	const imgRef = useRef<HTMLImageElement | null>(null);
	const pointerActiveRef = useRef(false);
	const [hoverElement, setHoverElement] = useState<ScreenElement | null>(null);

	useEffect(() => {
		if (liveControl) setHoverElement(null);
	}, [liveControl]);

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
			return selectionFromPoint(elements, point);
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
			setHoverElement(null);
			onSelect(next);
			onSelectWithPoint?.(next);
		},
		[liveControl, onClearSelection, onSelect, onSelectWithPoint, selectAtEvent, selection],
	);

	const handleDoubleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (liveControl) return;
			const next = selectAtEvent(event);
			if (next) onDoubleTap(next);
		},
		[liveControl, onDoubleTap, selectAtEvent],
	);

	const handleHoverMove = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (liveControl || disabled || pointerActiveRef.current) return;
			if (elements.length === 0) {
				setHoverElement(null);
				return;
			}
			const point = coordsAtEvent(event);
			if (!point) {
				setHoverElement(null);
				return;
			}
			const hit = hitTestElements(elements, point.x, point.y);
			setHoverElement(hit);
		},
		[coordsAtEvent, disabled, elements, liveControl],
	);

	const handlePointerLeave = useCallback(() => {
		setHoverElement(null);
	}, []);

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
			if (liveControl && pointerActiveRef.current) {
				const point = coordsAtEvent(event);
				if (!point) return;
				onPointer("move", point.x, point.y);
				return;
			}
			handleHoverMove(event);
		},
		[coordsAtEvent, handleHoverMove, liveControl, onPointer],
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

	const hoverBox =
		hoverElement &&
		!liveControl &&
		!(
			selection?.element &&
			hoverElement.x === selection.element.x &&
			hoverElement.y === selection.element.y &&
			hoverElement.width === selection.element.width &&
			hoverElement.height === selection.element.height
		)
			? elementBoxPercent(hoverElement)
			: null;

	const liveLabel =
		feedMode === "poll" ? "Poll" : feedMode === "mjpeg" ? "Stream" : live ? "Live" : null;

	const caption = selection ? activeSelectorCaption(selection) : null;
	const canInspect = !disabled && !liveControl;
	const showRefreshing = treeRefreshing && elements.length === 0;

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
					{live && canInspect ? (
						<button
							type="button"
							className="rounded-md px-1.5 py-0.5 text-helper font-medium text-on-surface-variant underline-offset-2 hover:text-on-surface hover:underline disabled:opacity-50"
							disabled={treeRefreshing}
							onClick={() => {
								onRefreshTree();
							}}
						>
							{treeRefreshing ? "Refreshing…" : "Refresh tree"}
						</button>
					) : null}
				</div>
				{liveControl ? (
					<span className="text-helper text-on-surface-variant">
						Tap / drag to control · double-click to double-tap
					</span>
				) : showRefreshing ? (
					<span className="text-helper text-on-surface-variant">Refreshing…</span>
				) : selection && caption ? (
					<span className="max-w-[55%] truncate text-helper text-on-surface-variant">
						{caption} · {selection.x},{selection.y}
					</span>
				) : selection ? (
					<span className="max-w-[55%] truncate text-helper text-on-surface-variant">
						{selection.x},{selection.y}
					</span>
				) : (
					<span className="text-helper text-on-surface-variant">
						Hover to preview · click to select · double-click to insert tap
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
									? "Live device screen — tap, drag, or double-click to double-tap"
									: "Live device screen — hover to preview, click to select actions, double-click to add tap"
							}
							className={[
								"relative block w-fit max-w-full touch-none",
								disabled
									? "cursor-wait opacity-60"
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
							onPointerLeave={handlePointerLeave}
						>
							<img
								ref={imgRef}
								alt="Live device screenshot"
								className="pointer-events-none block max-h-[min(72vh,760px)] w-auto max-w-full rounded-lg shadow-[0_12px_40px_-18px_rgba(0,0,0,0.45)] select-none"
								draggable={false}
								src={imageUrl}
							/>
							{hoverBox ? (
								<span
									aria-hidden="true"
									className="pointer-events-none absolute border border-dashed border-secondary/70 bg-secondary/10"
									style={{
										left: `${hoverBox.left}%`,
										top: `${hoverBox.top}%`,
										width: `${hoverBox.width}%`,
										height: `${hoverBox.height}%`,
									}}
								/>
							) : null}
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
							<>
								{caption ? (
									<div
										className="pointer-events-none absolute z-10 max-w-[14rem] truncate rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white"
										style={{
											left: `${selectionAnchor.left}%`,
											top: `calc(${selectionAnchor.top + selectionAnchor.height}% + 4px)`,
										}}
									>
										{caption}
									</div>
								) : null}
								<ElementActionMenu
									key={`${selection.x},${selection.y},${selection.candidateIndex},${selection.preferredLocator},${selection.element?.id ?? ""},${selection.element?.label ?? ""}`}
									selection={selection}
									anchor={selectionAnchor}
									disabled={disabled}
									snippetContext={snippetContext}
									canChangeSelector={Boolean(selection.element)}
									onChangeSelector={onChangeSelector}
									onInsert={onInsertLines}
									onInsertAndRun={onInsertAndRunLines}
									onCopyLines={onCopyLines}
									onClearSelection={onClearSelection}
								/>
							</>
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
