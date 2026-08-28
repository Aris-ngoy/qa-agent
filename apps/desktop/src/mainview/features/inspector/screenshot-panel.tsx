import type { SnippetContext } from "@/features/inspector/command-snippets";
import { ElementActionMenu } from "@/features/inspector/element-action-menu";
import { coordsFromImageRect, isPickPointModifier } from "@/features/inspector/inspect-pointer";
import {
	type InspectorSelection,
	activeSelectorCaption,
	hitTestElements,
	pointOnlySelection,
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
	/** Ignore click/contextmenu that follow a Control-pick pointerdown (macOS). */
	const pickAtMsRef = useRef(0);
	const [hoverElement, setHoverElement] = useState<ScreenElement | null>(null);
	const [pickPointHeld, setPickPointHeld] = useState(false);
	const [pickHover, setPickHover] = useState<{ x: number; y: number } | null>(null);

	useEffect(() => {
		if (liveControl) {
			setHoverElement(null);
			setPickHover(null);
		}
	}, [liveControl]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Control") return;
			setPickPointHeld(event.type === "keydown");
			if (event.type === "keyup") setPickHover(null);
		};
		const onBlur = () => {
			setPickPointHeld(false);
			setPickHover(null);
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("keyup", onKey);
		window.addEventListener("blur", onBlur);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("keyup", onKey);
			window.removeEventListener("blur", onBlur);
		};
	}, []);

	const canInspect = !disabled && !liveControl;
	const pickingPoint = canInspect && pickPointHeld;

	const coordsAtEvent = useCallback(
		(event: { clientX: number; clientY: number }): { x: number; y: number } | null => {
			if (!imgRef.current) return null;
			const rect = imgRef.current.getBoundingClientRect();
			return coordsFromImageRect(rect, event.clientX, event.clientY);
		},
		[],
	);

	const applySelection = useCallback(
		(next: InspectorSelection, options: { refreshTree?: boolean } = {}) => {
			if (selection && isSameSelection(selection, next)) {
				onClearSelection();
				return;
			}
			setHoverElement(null);
			onSelect(next);
			if (options.refreshTree !== false) onSelectWithPoint?.(next);
		},
		[onClearSelection, onSelect, onSelectWithPoint, selection],
	);

	const recentlyPicked = useCallback(() => Date.now() - pickAtMsRef.current < 400, []);

	const pickPointAtEvent = useCallback(
		(event: { clientX: number; clientY: number; ctrlKey: boolean }): boolean => {
			if (!canInspect || !isPickPointModifier(event)) return false;
			const point = coordsAtEvent(event);
			if (!point) return false;
			pickAtMsRef.current = Date.now();
			applySelection(pointOnlySelection(point), { refreshTree: false });
			return true;
		},
		[applySelection, canInspect, coordsAtEvent],
	);

	const selectAtEvent = useCallback(
		(event: MouseEvent<HTMLElement>): InspectorSelection | null => {
			if (disabled || !imgRef.current) return null;
			const point = coordsAtEvent(event);
			if (!point) return null;
			if (isPickPointModifier(event)) return pointOnlySelection(point);
			return selectionFromPoint(elements, point);
		},
		[coordsAtEvent, disabled, elements],
	);

	const handleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (liveControl) return;
			if (recentlyPicked()) return;
			if (isPickPointModifier(event)) {
				pickPointAtEvent(event);
				return;
			}
			const next = selectAtEvent(event);
			if (!next) return;
			applySelection(next);
		},
		[applySelection, liveControl, pickPointAtEvent, recentlyPicked, selectAtEvent],
	);

	const handleContextMenu = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (!isPickPointModifier(event) || liveControl) return;
			event.preventDefault();
			if (recentlyPicked()) return;
			pickPointAtEvent(event);
		},
		[liveControl, pickPointAtEvent, recentlyPicked],
	);

	const handleDoubleClick = useCallback(
		(event: MouseEvent<HTMLElement>) => {
			if (liveControl || isPickPointModifier(event)) return;
			const next = selectAtEvent(event);
			if (next) onDoubleTap(next);
		},
		[liveControl, onDoubleTap, selectAtEvent],
	);

	const handleHoverMove = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (liveControl || disabled || pointerActiveRef.current) return;
			const picking = isPickPointModifier(event) || pickPointHeld;
			if (picking) {
				setHoverElement(null);
				setPickHover(coordsAtEvent(event));
				return;
			}
			setPickHover(null);
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
		[coordsAtEvent, disabled, elements, liveControl, pickPointHeld],
	);

	const handlePointerLeave = useCallback(() => {
		setHoverElement(null);
		setPickHover(null);
	}, []);

	const handlePointerDown = useCallback(
		(event: PointerEvent<HTMLElement>) => {
			if (disabled) return;
			if (canInspect && isPickPointModifier(event) && event.button === 0) {
				event.preventDefault();
				pickPointAtEvent(event);
				return;
			}
			if (!liveControl) return;
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			const point = coordsAtEvent(event);
			if (!point) return;
			pointerActiveRef.current = true;
			onClearSelection();
			onPointer("begin", point.x, point.y);
		},
		[
			canInspect,
			coordsAtEvent,
			disabled,
			liveControl,
			onClearSelection,
			onPointer,
			pickPointAtEvent,
		],
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
		!pickingPoint &&
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
	const showRefreshing = treeRefreshing && elements.length === 0;
	const inspectHint = pickingPoint
		? "Picking x,y · click to set point"
		: "Hover to preview · click to select · Hold Control to pick x,y";

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
				) : pickingPoint ? (
					<span className="text-helper text-on-surface-variant">{inspectHint}</span>
				) : selection && caption ? (
					<span className="max-w-[55%] truncate text-helper text-on-surface-variant">
						{caption} · {selection.x},{selection.y}
					</span>
				) : selection ? (
					<span className="max-w-[55%] truncate text-helper text-on-surface-variant">
						{selection.x},{selection.y}
					</span>
				) : (
					<span className="text-helper text-on-surface-variant">{inspectHint}</span>
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
									: pickingPoint
										? "Live device screen — Control held, click to pick x,y"
										: "Live device screen — hover to preview, click to select actions, hold Control to pick x,y"
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
							onContextMenu={disabled ? undefined : handleContextMenu}
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
							{pickHover && pickingPoint ? (
								<>
									<span
										aria-hidden="true"
										className="pointer-events-none absolute left-0 h-px w-full bg-secondary/80"
										style={{ top: `${pickHover.y / 10}%` }}
									/>
									<span
										aria-hidden="true"
										className="pointer-events-none absolute top-0 h-full w-px bg-secondary/80"
										style={{ left: `${pickHover.x / 10}%` }}
									/>
									<span
										aria-hidden="true"
										className="pointer-events-none absolute z-20 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white"
										style={{
											left: `${pickHover.x / 10}%`,
											top: `${pickHover.y / 10}%`,
											transform: "translate(8px, 8px)",
										}}
									>
										{pickHover.x},{pickHover.y}
									</span>
								</>
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
								) : (
									<div
										className="pointer-events-none absolute z-10 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white"
										style={{
											left: `${selectionAnchor.left}%`,
											top: `calc(${selectionAnchor.top + selectionAnchor.height}% + 4px)`,
										}}
									>
										{selection.x},{selection.y}
									</div>
								)}
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
