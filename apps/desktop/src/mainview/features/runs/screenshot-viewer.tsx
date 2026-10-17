import {
	DOUBLE_CLICK_SCALE,
	FIT_VIEW,
	type Point,
	type Size,
	type ViewTransform,
	ZOOM_STEP,
	actualPixelScale,
	fitSize,
	panBy,
	rotateView,
	wheelZoomFactor,
	zoomAt,
	zoomPercent,
	zoomTo,
} from "@/features/runs/viewer-zoom";
import { Modal } from "@heroui/react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

type Pan = { pointerId: number; lastX: number; lastY: number; moved: boolean };

const TOOL_BUTTON =
	"inline-flex size-8 items-center justify-center rounded-lg text-on-surface transition-colors hover:bg-surface-container disabled:opacity-40 disabled:hover:bg-transparent";

/**
 * A full-window look at one Run screenshot: wheel or pinch to zoom around the cursor, drag to pan,
 * double-click to zoom in or back to fit, rotate, and step through the Run with the arrow keys.
 * The zoom carries over between steps so the same spot can be compared step to step.
 */
export function ScreenshotViewer({
	isOpen,
	onOpenChange,
	src,
	alt,
	title,
	onPrevious,
	onNext,
}: {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	src: string | null;
	alt: string;
	title: string;
	onPrevious?: () => void;
	onNext?: () => void;
}) {
	return (
		<Modal>
			<Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
				<Modal.Container placement="center" size="cover">
					<Modal.Dialog
						aria-label={title}
						className="flex h-full max-h-full w-full flex-col gap-0 overflow-hidden p-0"
					>
						{isOpen && src ? (
							<ViewerBody
								alt={alt}
								onClose={() => onOpenChange(false)}
								onNext={onNext}
								onPrevious={onPrevious}
								src={src}
								title={title}
							/>
						) : null}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function ViewerBody({
	src,
	alt,
	title,
	onClose,
	onPrevious,
	onNext,
}: {
	src: string;
	alt: string;
	title: string;
	onClose: () => void;
	onPrevious?: () => void;
	onNext?: () => void;
}) {
	const stageRef = useRef<HTMLDivElement>(null);
	const panRef = useRef<Pan | null>(null);
	const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
	const [natural, setNatural] = useState<Size>({ width: 0, height: 0 });
	const [view, setView] = useState<ViewTransform>(FIT_VIEW);
	const [panning, setPanning] = useState(false);

	useEffect(() => {
		const el = stageRef.current;
		if (!el || typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(() =>
			setStage({ width: el.clientWidth, height: el.clientHeight }),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	/** A stage point relative to its centre, where the image's transform origin sits. */
	const stagePoint = (event: { clientX: number; clientY: number }): Point => {
		const rect = stageRef.current?.getBoundingClientRect();
		if (!rect) return { x: 0, y: 0 };
		return {
			x: event.clientX - rect.left - rect.width / 2,
			y: event.clientY - rect.top - rect.height / 2,
		};
	};

	// React's wheel listener is passive, so it cannot stop the page from scrolling instead.
	useEffect(() => {
		const el = stageRef.current;
		if (!el) return;
		const onWheel = (event: WheelEvent) => {
			event.preventDefault();
			const rect = el.getBoundingClientRect();
			const point = {
				x: event.clientX - rect.left - rect.width / 2,
				y: event.clientY - rect.top - rect.height / 2,
			};
			setView((current) => zoomAt(current, wheelZoomFactor(event.deltaY, event.ctrlKey), point));
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	const pad = 48;
	const fitted = fitSize(
		{ width: Math.max(0, stage.width - pad), height: Math.max(0, stage.height - pad) },
		natural,
		view.rotation,
	);
	const zoomed = Math.abs(view.scale - 1) > 0.001 || view.x !== 0 || view.y !== 0;
	const fit = () => setView((current) => ({ ...FIT_VIEW, rotation: current.rotation }));
	const actualSize = () => setView((current) => zoomTo(current, actualPixelScale(fitted, natural)));

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		const key = event.key;
		if (key === "+" || key === "=")
			setView((current) => zoomAt(current, ZOOM_STEP, { x: 0, y: 0 }));
		else if (key === "-" || key === "_")
			setView((current) => zoomAt(current, 1 / ZOOM_STEP, { x: 0, y: 0 }));
		else if (key === "0") fit();
		else if (key === "1") actualSize();
		else if (key === "r" || key === "R")
			setView((current) => rotateView(current, event.shiftKey ? -1 : 1));
		else if (key === "ArrowLeft" && onPrevious) onPrevious();
		else if (key === "ArrowRight" && onNext) onNext();
		else return;
		event.preventDefault();
	};
	// The dialog, not this body, holds focus, so listen on the window while the viewer is open.
	const keyHandlerRef = useRef(onKeyDown);
	keyHandlerRef.current = onKeyDown;
	useEffect(() => {
		const listener = (event: KeyboardEvent) => keyHandlerRef.current(event);
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, []);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		panRef.current = {
			pointerId: event.pointerId,
			lastX: event.clientX,
			lastY: event.clientY,
			moved: false,
		};
		setPanning(true);
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		if (!pan || pan.pointerId !== event.pointerId) return;
		const dx = event.clientX - pan.lastX;
		const dy = event.clientY - pan.lastY;
		pan.lastX = event.clientX;
		pan.lastY = event.clientY;
		pan.moved ||= Math.abs(dx) + Math.abs(dy) > 0;
		setView((current) => panBy(current, dx, dy));
	};

	const endPan = (event: PointerEvent<HTMLDivElement>) => {
		if (panRef.current?.pointerId !== event.pointerId) return;
		panRef.current = null;
		setPanning(false);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex flex-wrap items-center gap-2 border-b border-outline-variant px-4 py-2.5">
				<Modal.Heading className="mr-auto text-body-md font-semibold text-on-surface">
					{title}
				</Modal.Heading>
				<div className="flex items-center gap-0.5 rounded-xl border border-outline-variant bg-surface-bright p-0.5">
					{onPrevious || onNext ? (
						<>
							<ToolButton disabled={!onPrevious} label="Previous step (←)" onPress={onPrevious}>
								<path d="m15 18-6-6 6-6" />
							</ToolButton>
							<ToolButton disabled={!onNext} label="Next step (→)" onPress={onNext}>
								<path d="m9 18 6-6-6-6" />
							</ToolButton>
							<Divider />
						</>
					) : null}
					<ToolButton
						label="Zoom out (−)"
						onPress={() => setView((current) => zoomAt(current, 1 / ZOOM_STEP, { x: 0, y: 0 }))}
					>
						<path d="M5 12h14" />
					</ToolButton>
					<span
						aria-live="polite"
						className="min-w-12 text-center font-mono text-helper text-on-surface-variant"
					>
						{zoomPercent(view, fitted, natural)}
					</span>
					<ToolButton
						label="Zoom in (+)"
						onPress={() => setView((current) => zoomAt(current, ZOOM_STEP, { x: 0, y: 0 }))}
					>
						<path d="M12 5v14M5 12h14" />
					</ToolButton>
					<Divider />
					<button
						className={`${TOOL_BUTTON} w-auto px-2 text-helper font-semibold`}
						disabled={!zoomed}
						onClick={fit}
						title="Fit to window (0)"
						type="button"
					>
						Fit
					</button>
					<button
						className={`${TOOL_BUTTON} w-auto px-2 text-helper font-semibold`}
						disabled={natural.width === 0}
						onClick={actualSize}
						title="Actual pixels (1)"
						type="button"
					>
						1:1
					</button>
					<Divider />
					<ToolButton
						label="Rotate left (Shift+R)"
						onPress={() => setView((current) => rotateView(current, -1))}
					>
						<path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
						<path d="M3 3v5h5" />
					</ToolButton>
					<ToolButton
						label="Rotate right (R)"
						onPress={() => setView((current) => rotateView(current, 1))}
					>
						<path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
						<path d="M21 3v5h-5" />
					</ToolButton>
				</div>
				<ToolButton label="Close (Esc)" onPress={onClose}>
					<path d="M18 6 6 18M6 6l12 12" />
				</ToolButton>
			</div>

			<div
				aria-label={`${alt} — scroll to zoom, drag to pan, double-click to zoom`}
				className={[
					"relative min-h-0 flex-1 touch-none overflow-hidden bg-surface-container select-none",
					panning ? "cursor-grabbing" : "cursor-grab",
				].join(" ")}
				onDoubleClick={(event) => {
					const point = stagePoint(event);
					setView((current) =>
						Math.abs(current.scale - 1) > 0.001
							? { ...FIT_VIEW, rotation: current.rotation }
							: zoomTo(current, DOUBLE_CLICK_SCALE, point),
					);
				}}
				onPointerCancel={endPan}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endPan}
				ref={stageRef}
				role="img"
			>
				<img
					alt={alt}
					className={[
						"pointer-events-none absolute top-1/2 left-1/2 max-w-none rounded-md shadow-float",
						panning
							? ""
							: "transition-transform duration-150 ease-out motion-reduce:transition-none",
						fitted.width === 0 ? "invisible" : "",
					].join(" ")}
					draggable={false}
					onLoad={(event) =>
						setNatural({
							width: event.currentTarget.naturalWidth,
							height: event.currentTarget.naturalHeight,
						})
					}
					src={src}
					style={{
						width: fitted.width,
						height: fitted.height,
						transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${view.rotation}deg)`,
					}}
				/>
			</div>

			<p className="m-0 border-t border-outline-variant px-4 py-2 text-center text-helper text-on-surface-variant">
				Scroll or pinch to zoom · drag to pan · double-click to zoom in or fit
				{onPrevious || onNext ? " · ← → to change step" : ""}
			</p>
		</div>
	);
}

function ToolButton({
	label,
	onPress,
	disabled = false,
	children,
}: {
	label: string;
	onPress?: () => void;
	disabled?: boolean;
	children: ReactNode;
}) {
	return (
		<button
			aria-label={label}
			className={TOOL_BUTTON}
			disabled={disabled}
			onClick={onPress}
			title={label}
			type="button"
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
				{children}
			</svg>
		</button>
	);
}

function Divider() {
	return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-outline-variant" />;
}
