/**
 * Renders assets/icon.svg into assets/icon.ico (16–256 px PNG frames) for `build.win.icon`.
 * Cross-platform (resvg only); `generate-app-icon.ts` calls it after the macOS assets.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { pngsToIco } from "../src/bun/features/windows-icon";

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export async function generateWindowsIcon(root: string): Promise<string> {
	const svg = await Bun.file(join(root, "assets/icon.svg")).text();
	const frames = ICO_SIZES.map((size) => ({
		size,
		png: new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()),
	}));
	const icoPath = join(root, "assets/icon.ico");
	writeFileSync(icoPath, pngsToIco(frames));
	return icoPath;
}

if (import.meta.main) {
	const icoPath = await generateWindowsIcon(join(import.meta.dir, ".."));
	console.log(`Generated ${icoPath} (${ICO_SIZES.length} sizes)`);
}
