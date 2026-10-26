/** One square PNG frame for an `.ico`, at `size` pixels (1–256). */
export type IcoFrame = { size: number; png: Uint8Array };

const HEADER_BYTES = 6;
const ENTRY_BYTES = 16;

/**
 * Pack PNG frames into a Windows `.ico` (Vista+ PNG-compressed entries).
 * Used for `build.win.icon`: electrobun copies it as `Resources/app.ico` and rcedit embeds
 * it into the exes, and both need a real ICO, not a renamed PNG.
 */
export function pngsToIco(frames: IcoFrame[]): Uint8Array {
	if (frames.length === 0) throw new Error("An .ico needs at least one frame");
	const sorted = [...frames].sort((a, b) => a.size - b.size);
	const dataStart = HEADER_BYTES + ENTRY_BYTES * sorted.length;
	const total = dataStart + sorted.reduce((sum, frame) => sum + frame.png.byteLength, 0);
	const out = new Uint8Array(total);
	const view = new DataView(out.buffer);

	view.setUint16(0, 0, true); // reserved
	view.setUint16(2, 1, true); // type: icon
	view.setUint16(4, sorted.length, true);

	let offset = dataStart;
	sorted.forEach((frame, index) => {
		if (!Number.isInteger(frame.size) || frame.size < 1 || frame.size > 256) {
			throw new Error(`ICO frames must be 1–256 px, got ${frame.size}`);
		}
		const entry = HEADER_BYTES + ENTRY_BYTES * index;
		// 0 means 256 in the one-byte width/height fields.
		view.setUint8(entry, frame.size % 256);
		view.setUint8(entry + 1, frame.size % 256);
		view.setUint8(entry + 2, 0); // palette colors
		view.setUint8(entry + 3, 0); // reserved
		view.setUint16(entry + 4, 1, true); // color planes
		view.setUint16(entry + 6, 32, true); // bits per pixel
		view.setUint32(entry + 8, frame.png.byteLength, true);
		view.setUint32(entry + 12, offset, true);
		out.set(frame.png, offset);
		offset += frame.png.byteLength;
	});
	return out;
}
