export type Slot = "a" | "b";
export type Slots = { a: string | null; b: string | null; front: Slot };

export const EMPTY_SLOTS: Slots = { a: null, b: null, front: "a" };
/** A stream may never fire `load` for its multipart body; show it after this anyway. */
export const STREAM_PROMOTE_MS = 1500;

export function otherSlot(slot: Slot): Slot {
	return slot === "a" ? "b" : "a";
}

/** Next slots for a new `src`: the first frame goes straight to the front, later ones load behind it. */
export function nextSlots(prev: Slots, src: string | null): Slots {
	if (src == null) return EMPTY_SLOTS;
	const front = prev[prev.front];
	if (front == null) return { ...prev, [prev.front]: src };
	if (front === src) return prev;
	return { ...prev, [otherSlot(prev.front)]: src };
}

/** Bring `slot` to the front once it holds `url`; the old front unmounts (closing a stream). */
export function promoteSlot(prev: Slots, slot: Slot, url: string): Slots {
	if (prev[slot] !== url || prev.front === slot) return prev;
	return { ...prev, front: slot, [otherSlot(slot)]: null };
}
