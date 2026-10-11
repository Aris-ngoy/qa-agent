import type { Observable } from "@legendapp/state";
import { useValue } from "@legendapp/state/react";
import { type Ref, useEffect, useState } from "react";

type Slot = "a" | "b";
type Slots = { a: string | null; b: string | null; front: Slot };

const EMPTY: Slots = { a: null, b: null, front: "a" };
/** A stream may never fire `load` for its multipart body; show it after this anyway. */
const STREAM_PROMOTE_MS = 1500;

function other(slot: Slot): Slot {
	return slot === "a" ? "b" : "a";
}

/** Next slots for a new `src`: the first frame goes straight to the front, later ones load behind it. */
export function nextSlots(prev: Slots, src: string | null): Slots {
	if (src == null) return EMPTY;
	const front = prev[prev.front];
	if (front == null) return { ...prev, [prev.front]: src };
	if (front === src) return prev;
	return { ...prev, [other(prev.front)]: src };
}

/** Bring `slot` to the front once it holds `url`; the old front unmounts (closing a stream). */
export function promoteSlot(prev: Slots, slot: Slot, url: string): Slots {
	if (prev[slot] !== url || prev.front === slot) return prev;
	return { ...prev, front: slot, [other(slot)]: null };
}

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
	const src = useValue(src$);
	const [slots, setSlots] = useState<Slots>(EMPTY);

	useEffect(() => {
		setSlots((prev) => nextSlots(prev, src));
	}, [src]);

	const back = other(slots.front);
	const backUrl = slots[back];
	useEffect(() => {
		if (!backUrl || backUrl.startsWith("blob:")) return;
		const timer = window.setTimeout(() => {
			setSlots((prev) => promoteSlot(prev, back, backUrl));
		}, STREAM_PROMOTE_MS);
		return () => window.clearTimeout(timer);
	}, [back, backUrl]);

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
						onLoad={() => setSlots((prev) => promoteSlot(prev, slot, url))}
					/>
				);
			})}
		</>
	);
}
