import { describe, expect, test } from "bun:test";
import { decodePng, encodeRgbaPng, overlayCoordGrid, pointFromGridCell } from "./coord-grid";

describe("overlayCoordGrid", () => {
	test("draws the 500-line in magenta and leaves a cell interior alone", () => {
		const width = 100;
		const height = 100;
		const rgba = new Uint8Array(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			rgba[i * 4] = 200;
			rgba[i * 4 + 1] = 20;
			rgba[i * 4 + 2] = 20;
			rgba[i * 4 + 3] = 255;
		}
		const source = encodeRgbaPng({ width, height, rgba }).toString("base64");
		const overlaid = overlayCoordGrid(source);
		expect(overlaid).not.toBeNull();
		const image = decodePng(Buffer.from(overlaid ?? "", "base64"));
		expect(image).not.toBeNull();
		const at = (x: number, y: number) => {
			const index = ((image?.width ?? 0) * y + x) * 4;
			return [image?.rgba[index], image?.rgba[index + 1], image?.rgba[index + 2]];
		};
		expect(at(50, 8)).toEqual([255, 0, 255]);
		expect(at(5, 5)).toEqual([200, 20, 20]);
	});

	test("leaves a non-png screenshot unchanged by returning null", () => {
		expect(overlayCoordGrid("aaa")).toBeNull();
	});

	test("paints a white digit in the top-left cell and leaves the cell centre alone", () => {
		const width = 400;
		const height = 400;
		const rgba = new Uint8Array(width * height * 4);
		for (let i = 0; i < width * height; i++) {
			rgba[i * 4] = 10;
			rgba[i * 4 + 1] = 20;
			rgba[i * 4 + 2] = 30;
			rgba[i * 4 + 3] = 255;
		}
		const overlaid = overlayCoordGrid(encodeRgbaPng({ width, height, rgba }).toString("base64"));
		const image = decodePng(Buffer.from(overlaid ?? "", "base64"));
		expect(image).not.toBeNull();
		const at = (x: number, y: number) => {
			const index = ((image?.width ?? 0) * y + x) * 4;
			return [image?.rgba[index], image?.rgba[index + 1], image?.rgba[index + 2]];
		};
		expect(at(4, 3)).toEqual([255, 255, 255]);
		expect(at(20, 20)).toEqual([10, 20, 30]);
	});
});

describe("pointFromGridCell", () => {
	test("computes the middle of a cell when the model does not say where inside it", () => {
		expect(pointFromGridCell({ col: 3, row: 6 })).toEqual({ x: 350, y: 650 });
	});

	test("computes a corner of the cell from qx and qy", () => {
		expect(pointFromGridCell({ col: 1, row: 2, qx: 0, qy: 9 })).toEqual({ x: 105, y: 295 });
	});
});
