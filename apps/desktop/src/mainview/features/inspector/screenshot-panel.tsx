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
	/** Optional: notify parent after a local select so it can background-refresh a stale tree. */
	onSelectWithPoint?: (selection: InspectorSelection) => void;
	onSelect: (selection: InspectorSelection) => void;
	onRefreshTree: () => void;
	/** Double-click records a tap for the hit element/point. */
	onDoubleTap: (selection: InspectorSelection) => void;
	onPointer: (phase: "begin" | "move" | "end", x: number, y: number) => void;
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
	onSelectWithPoint,
	onSelect,
	onRefreshTree,
	onDoubleTap,
	onPointer,
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
		: "Hover to preview, click to select an element.";

	return (
		<section
			aria-labelledby="inspector-device-heading"
			className="flex flex-col gap-3.5 rounded-[18px] border border-outline-variant bg-surface-bright p-4"
		>
			<div className="flex items-center justify-between gap-2">
				<h2 id="inspector-device-heading" className="text-subheading text-on-surface">
					Device
				</h2>
				<div className="flex items-center gap-2">
					{liveLabel ? (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-2 py-0.5 text-helper font-semibold text-on-secondary-container">
							<span className="relative flex size-1.5">
								<span className="absolute inline-flex size-full animate-ping rounded-full bg-secondary opacity-60" />
								<span className="relative inline-flex size-1.5 rounded-full bg-secondary" />
							</span>
							{liveLabel}
						</span>
					) : null}
					{live && canInspect ? (
						<button
							type="button"
							aria-label="Refresh element tree"
							title="Refresh element tree"
							className="inline-flex size-9 items-center justify-center rounded-lg border border-outline-variant bg-surface-bright text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50"
							disabled={treeRefreshing}
							onClick={() => {
								onRefreshTree();
							}}
						>
							<svg
								aria-hidden="true"
								className={["size-4", treeRefreshing ? "animate-spin" : ""].join(" ")}
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
							>
								<path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
								<path d="M21 3v5h-5" />
							</svg>
						</button>
					) : null}
				</div>
			</div>

			<fieldset
				aria-label="Pointer mode"
				className="m-0 grid min-w-0 grid-cols-2 gap-1 rounded-[10px] border-0 bg-surface-container p-1"
			>
				{(["inspect", "interact"] as const).map((mode) => {
					const selected = (mode === "interact") === liveControl;
					return (
						<button
							key={mode}
							type="button"
							aria-pressed={selected}
							disabled={mode === "interact" && (!live || disabled)}
							className={[
								"inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg text-body-md font-semibold transition-colors disabled:opacity-50",
								selected
									? "bg-surface-bright text-on-surface shadow-[0_1px_2px_rgba(27,26,34,0.12)]"
									: "text-on-surface-variant hover:text-on-surface",
							].join(" ")}
							onClick={() => onLiveControlChange(mode === "interact")}
						>
							<svg
								aria-hidden="true"
								className="size-4"
								fill="none"
								stroke="currentColor"
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth="2"
								viewBox="0 0 24 24"
							>
								{mode === "inspect" ? (
									<path d="M4 4l7 17 2.5-7.5L21 11z" />
								) : (
									<>
										<path d="M9 11V5a2 2 0 0 1 4 0v6" />
										<path d="M13 10a2 2 0 0 1 4 0v4a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-1.5-3a1.5 1.5 0 0 1 2.6-1.5L9 15" />
									</>
								)}
							</svg>
							{mode === "inspect" ? "Inspect" : "Use device"}
						</button>
					);
				})}
			</fieldset>
			<p className="-mt-1 text-body-sm text-on-surface-variant">
				{liveControl
					? "Taps and swipes go straight to the device · double-click to double-tap."
					: showRefreshing
						? "Refreshing…"
						: pickingPoint
							? inspectHint
							: selection
								? `${caption ? `${caption} · ` : ""}${selection.x},${selection.y}`
								: inspectHint}
			</p>

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
								className="pointer-events-none block max-h-[min(72vh,760px)] w-auto max-w-full rounded-[28px] shadow-[0_12px_40px_-18px_rgba(0,0,0,0.45)] select-none"
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
			<p className="m-0 text-center text-helper text-on-surface-variant">
				Hold{" "}
				<kbd className="rounded border border-outline-variant bg-surface-container px-1 font-mono">
					Ctrl
				</kbd>{" "}
				and click to pick exact x, y coordinates
			</p>
		</section>
	);
}
