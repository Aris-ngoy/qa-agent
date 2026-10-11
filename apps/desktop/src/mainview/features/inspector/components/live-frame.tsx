import {
	EMPTY_SLOTS,
	STREAM_PROMOTE_MS,
	type Slots,
	nextSlots,
	otherSlot,
	promoteSlot,
} from "@/features/inspector/utils/live-frame-slots";
import type { Observable } from "@legendapp/state";
import { useObservable, useObserveEffect, useValue } from "@legendapp/state/react";
import { type Ref, useEffect } from "react";

type LiveFrameProps = {
	src$: Observable<string | null>;
	/** Points at the frame on screen, for pointer hit-testing. */
	imgRef: Ref<HTMLImageElement>;
	className: string;
};

/**
 * Device frames double-buffered: each new frame loads in a hidden `<img>` behind the shown
 * one and swaps in only once it has painted, so poll ticks and stream remounts never flash
 * an empty box. Subscribes to the frame itself, so a tick re-renders only this component.
 */
export function LiveFrame({ src$, imgRef, className }: LiveFrameProps) {
	const slots$ = useObservable<Slots>(EMPTY_SLOTS);
	const slots = useValue(slots$);

	useObserveEffect(() => {
		const src = src$.get();
		slots$.set((prev) => nextSlots(prev, src));
	});

	const back = otherSlot(slots.front);
	const backUrl = slots[back];
	useEffect(() => {
		if (!backUrl || backUrl.startsWith("blob:")) return;
		const timer = window.setTimeout(() => {
			slots$.set((prev) => promoteSlot(prev, back, backUrl));
		}, STREAM_PROMOTE_MS);
		return () => window.clearTimeout(timer);
	}, [back, backUrl, slots$]);

	return (
		<>
			{(["a", "b"] as const).map((slot) => {
				const url = slots[slot];
				if (!url) return null;
				const isFront = slot === slots.front;
				return (
					<img
						key={slot}
						ref={isFront ? imgRef : undefined}
						alt={isFront ? "Live device screenshot" : ""}
						aria-hidden={isFront ? undefined : true}
						className={[className, isFront ? "" : "absolute inset-0 opacity-0"].join(" ")}
						draggable={false}
						src={url}
						onLoad={() => slots$.set((prev) => promoteSlot(prev, slot, url))}
					/>
				);
			})}
		</>
	);
}
