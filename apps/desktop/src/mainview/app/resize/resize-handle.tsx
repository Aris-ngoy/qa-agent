import { widthFromDrag, widthFromKey } from "@/app/resize/panel-width";
import type { PanelWidth } from "@/app/resize/use-panel-width";
import { useObservable, useValue } from "@legendapp/state/react";
import { type KeyboardEvent, type PointerEvent, useRef } from "react";

type Drag = { pointerId: number; startX: number; startWidth: number };

/**
 * A vertical splitter that resizes `panel` by dragging, or with the arrow keys once focused.
 * `edge` is the panel edge it sits on: "end" for a panel on the left, "start" for one on the right.
 * Double-click puts the panel back to its default width.
 */
export function ResizeHandle({
	panel,
	edge,
	label,
	className = "",
}: {
	panel: PanelWidth;
	edge: "start" | "end";
	label: string;
	className?: string;
}) {
	const dragRef = useRef<Drag | null>(null);
	const dragging$ = useObservable(false);
	const dragging = useValue(dragging$);

	const endDrag = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		dragRef.current = null;
		dragging$.set(false);
		document.body.style.removeProperty("cursor");
		document.body.style.removeProperty("user-select");
		try {
			event.currentTarget.releasePointerCapture(event.pointerId);
		} catch {
			/* already released */
		}
		panel.setWidth(
			widthFromDrag(drag.startWidth, event.clientX - drag.startX, edge, panel.bounds()),
			{ persist: true },
		);
	};

	const { min, max } = panel.bounds();

	return (
		// biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged
		<div
			role="separator"
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemin={min}
			aria-valuemax={Math.max(min, Math.round(max))}
			aria-valuenow={panel.width}
			tabIndex={0}
			title={`${label} · double-click to reset`}
			data-dragging={dragging || undefined}
			className={[
				"group relative flex shrink-0 cursor-col-resize touch-none items-center justify-center self-stretch outline-none select-none",
				className,
			].join(" ")}
			onPointerDown={(event) => {
				if (event.button !== 0) return;
				event.preventDefault();
				event.currentTarget.setPointerCapture(event.pointerId);
				dragRef.current = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startWidth: panel.width,
				};
				dragging$.set(true);
				// Keep the resize cursor and stop text selection while the pointer is off the handle.
				document.body.style.cursor = "col-resize";
				document.body.style.userSelect = "none";
			}}
			onPointerMove={(event) => {
				const drag = dragRef.current;
				if (!drag || drag.pointerId !== event.pointerId) return;
				panel.setWidth(
					widthFromDrag(drag.startWidth, event.clientX - drag.startX, edge, panel.bounds()),
				);
			}}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onDoubleClick={() => panel.reset()}
			onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
				const next = widthFromKey(panel.width, event.key, event.shiftKey, edge, panel.bounds());
				if (next == null) return;
				event.preventDefault();
				panel.setWidth(next, { persist: true });
			}}
		>
			<span
				aria-hidden="true"
				className="h-full w-px rounded-full bg-transparent transition-colors group-hover:bg-outline-variant group-focus-visible:bg-primary group-data-[dragging]:bg-primary"
			/>
			<span
				aria-hidden="true"
				className="absolute top-1/2 h-10 w-1.5 -translate-y-1/2 rounded-full bg-outline-variant transition-colors group-hover:bg-outline group-focus-visible:bg-primary group-data-[dragging]:bg-primary"
			/>
		</div>
	);
}
