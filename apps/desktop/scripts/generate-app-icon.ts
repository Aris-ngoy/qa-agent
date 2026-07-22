import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Renders assets/icon.svg into:
 * - assets/icon.png (1024x1024, Windows/Linux + size source)
 * - assets/icon.iconset/* (macOS AppIcon via iconutil)
 *
 * Requires `@resvg/resvg-js` and macOS `sips`.
 */
import { Resvg } from "@resvg/resvg-js";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const svgPath = join(root, "assets/icon.svg");
const pngPath = join(root, "assets/icon.png");
const iconsetPath = join(root, "assets/icon.iconset");

// Build retina filenames at runtime to avoid "@2x" literals being mangled on write.
const at = String.fromCharCode(64);
const retina = (px: number) => `icon_${px}x${px}${at}2x.png`;
const standard = (px: number) => `icon_${px}x${px}.png`;

const sizes = [
	{ name: standard(16), size: 16 },
	{ name: retina(16), size: 32 },
	{ name: standard(32), size: 32 },
	{ name: retina(32), size: 64 },
	{ name: standard(128), size: 128 },
	{ name: retina(128), size: 256 },
	{ name: standard(256), size: 256 },
	{ name: retina(256), size: 512 },
	{ name: standard(512), size: 512 },
	{ name: retina(512), size: 1024 },
] as const;

rmSync(iconsetPath, { recursive: true, force: true });
mkdirSync(iconsetPath, { recursive: true });

const svg = await Bun.file(svgPath).text();
const resvg = new Resvg(svg, {
	fitTo: { mode: "width", value: 1024 },
});
const png = resvg.render().asPng();
writeFileSync(pngPath, png);

const tmpDir = join(root, "assets/.icon-tmp");
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

try {
	for (const { name, size } of sizes) {
		// sips mis-parses filenames that contain "@", so resize to a temp path first.
		const tmpOut = join(tmpDir, `${size}-${name.replaceAll(at, "_")}`);
		const result = await $`sips -z ${size} ${size} ${pngPath} --out ${tmpOut}`.quiet();
		if (result.exitCode !== 0) {
			throw new Error(`sips failed for ${name}:\n${result.stderr.toString()}`);
		}
		renameSync(tmpOut, join(iconsetPath, name));
	}
} finally {
	rmSync(tmpDir, { recursive: true, force: true });
}

// Keep the WebDriverAgent home-screen icon in sync with the desktop app mark.
const wdaIconPath = join(root, "../../services/runner/assets/wda-icon-1024.png");
mkdirSync(join(root, "../../services/runner/assets"), { recursive: true });
writeFileSync(wdaIconPath, png);

console.log(`Generated ${pngPath}`);
console.log(`Generated ${iconsetPath} (${sizes.length} sizes)`);
console.log(`Generated ${wdaIconPath}`);
