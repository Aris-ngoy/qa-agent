import { type InspectorSelection, hitTestElements } from "@/features/inspector/selection";
import type { ScreenElement } from "@yoqa/runner-client";
import { type MouseEvent, useCallback, useRef } from "react";

type ScreenshotPanelProps = {
	imageUrl: string | null;
	elements: ScreenElement[];
	selection: InspectorSelection | null;
	loading: boolean;
	disabled: boolean;
	onSelect: (selection: InspectorSelection) => void;
};

export function ScreenshotPanel({
	imageUrl,
	elements,
	selection,
	loading,
	disabled,
	onSelect,
}: ScreenshotPanelProps) {
	const imgRef = useRef<HTMLImageElement | null>(null);

	const handleClick = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			if (disabled || !imgRef.current) return;
			const rect = imgRef.current.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			const x = Math.round(((event.clientX - rect.left) / rect.width) * 1000);
			const y = Math.round(((event.clientY - rect.top) / rect.height) * 1000);
			const clampedX = Math.min(1000, Math.max(0, x));
			const clampedY = Math.min(1000, Math.max(0, y));
			const element = hitTestElements(elements, clampedX, clampedY);
			if (element) {
				onSelect({
					x: Math.round(element.x + element.width / 2),
					y: Math.round(element.y + element.height / 2),
					element,
				});
			} else {
				onSelect({ x: clampedX, y: clampedY, element: null });
			}
		},
		[disabled, elements, onSelect],
	);

	return (
		<div className="flex h-full min-h-0 flex-col gap-2">
			<div className="flex items-baseline justify-between gap-2">
				<h2 className="text-title-sm font-semibold text-on-surface">Screen</h2>
				{selection ? (
					<span className="truncate text-helper text-on-surface-variant">
						{selection.element?.label || selection.element?.type || "point"} · {selection.x},
						{selection.y}
					</span>
				) : (
					<span className="text-helper text-on-surface-variant">Click to select</span>
				)}
			</div>

			<div className="relative min-h-0 flex-1 overflow-auto rounded-lg bg-surface-container">
				{!imageUrl && !loading ? (
					<div className="flex h-full min-h-48 items-center justify-center px-4 text-center text-body-sm text-on-surface-variant">
						Connect a device to load a live screenshot.
					</div>
				) : null}

				{imageUrl ? (
					<button
						type="button"
						aria-label="Device screenshot — click to select an element"
						className="relative mx-auto block w-fit max-w-full cursor-crosshair border-0 bg-transparent p-0 disabled:cursor-not-allowed disabled:opacity-60"
						disabled={disabled}
						onClick={handleClick}
					>
						<img
							ref={imgRef}
							alt="Device screenshot"
							className="block max-h-[min(70vh,720px)] w-auto max-w-full select-none"
							draggable={false}
							src={imageUrl}
						/>
						{selection ? (
							<span
								aria-hidden="true"
								className="pointer-events-none absolute border-2 border-secondary bg-secondary/15"
								style={{
									left: `${(selection.element?.x ?? Math.max(0, selection.x - 12)) / 10}%`,
									top: `${(selection.element?.y ?? Math.max(0, selection.y - 12)) / 10}%`,
									width: `${(selection.element?.width ?? 24) / 10}%`,
									height: `${(selection.element?.height ?? 24) / 10}%`,
								}}
							/>
						) : null}
					</button>
				) : null}

				{loading ? (
					<div className="absolute inset-0 flex items-center justify-center bg-surface/60 text-body-sm text-on-surface-variant">
						Loading screen…
					</div>
				) : null}
			</div>
		</div>
	);
}
