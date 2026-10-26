import { describe, expect, test } from "bun:test";
import { pngsToIco } from "./windows-icon";

const fakePng = (byte: number, length: number) => new Uint8Array(length).fill(byte);

describe("pngsToIco", () => {
	test("writes the ICO header and one directory entry per frame, smallest first", () => {
		const ico = pngsToIco([
			{ size: 256, png: fakePng(2, 5) },
			{ size: 16, png: fakePng(1, 3) },
		]);
		const view = new DataView(ico.buffer);

		expect(view.getUint16(0, true)).toBe(0);
		expect(view.getUint16(2, true)).toBe(1);
		expect(view.getUint16(4, true)).toBe(2);

		// 16 px frame
		expect(view.getUint8(6)).toBe(16);
		expect(view.getUint16(6 + 6, true)).toBe(32);
		expect(view.getUint32(6 + 8, true)).toBe(3);
		expect(view.getUint32(6 + 12, true)).toBe(38);

		// 256 px frame stores 0 in the width/height bytes
		expect(view.getUint8(22)).toBe(0);
		expect(view.getUint8(23)).toBe(0);
		expect(view.getUint32(22 + 8, true)).toBe(5);
		expect(view.getUint32(22 + 12, true)).toBe(41);

		expect([...ico.slice(38)]).toEqual([1, 1, 1, 2, 2, 2, 2, 2]);
	});

	test("rejects an empty frame list and frames larger than 256 px", () => {
		expect(() => pngsToIco([])).toThrow();
		expect(() => pngsToIco([{ size: 512, png: fakePng(0, 1) }])).toThrow();
	});
});
