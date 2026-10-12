import { copyFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
/**
 * Renders assets/icon.svg into:
 * - assets/icon.png (1024x1024, Windows/Linux + size source)
 * - assets/icon.iconset/* (macOS AppIcon via iconutil)
 * - the on-device runners: the iOS YoqaRunner asset catalog (AppIcon + Logo)
 *   and the Android devtools launcher mipmaps
 *
 * Requires `@resvg/resvg-js` and macOS `sips`.
 */
import { Resvg } from "@resvg/resvg-js";
import { $ } from "bun";

const root = join(import.meta.dir, "..");
const svgPath = join(root, "assets/icon.svg");
const pngPath = join(root, "assets/icon.png");
const iconsetPath = join(root, "assets/icon.iconset");
const nativeRoot = join(root, "../../native");
const iosAssetsPath = join(nativeRoot, "yoqa-runner/YoqaRunner/Assets.xcassets");
const androidResPath = join(nativeRoot, "android-devtools/app/src/main/res");

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

// Launcher icon sizes per Android density bucket (48dp).
const androidSizes = [
	{ density: "mdpi", size: 48 },
	{ density: "hdpi", size: 72 },
	{ density: "xhdpi", size: 96 },
	{ density: "xxhdpi", size: 144 },
	{ density: "xxxhdpi", size: 192 },
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
		await resize(size, tmpOut, name);
		renameSync(tmpOut, join(iconsetPath, name));
	}
	for (const { density, size } of androidSizes) {
		const dir = join(androidResPath, `mipmap-${density}`);
		mkdirSync(dir, { recursive: true });
		await resize(size, join(dir, "ic_launcher.png"), `mipmap-${density}`);
	}
} finally {
	rmSync(tmpDir, { recursive: true, force: true });
}

// iOS takes one 1024 icon and scales it; Logo is the same art for the host screen.
const appIconPath = join(iosAssetsPath, "AppIcon.appiconset");
const logoPath = join(iosAssetsPath, "Logo.imageset");
mkdirSync(appIconPath, { recursive: true });
mkdirSync(logoPath, { recursive: true });
copyFileSync(pngPath, join(appIconPath, "AppIcon.png"));
copyFileSync(pngPath, join(logoPath, "Logo.png"));

console.log(`Generated ${pngPath}`);
console.log(`Generated ${iconsetPath} (${sizes.length} sizes)`);
console.log(`Generated ${iosAssetsPath} (AppIcon, Logo)`);
console.log(`Generated ${androidResPath} (${androidSizes.length} mipmaps)`);

async function resize(size: number, out: string, label: string) {
	const result = await $`sips -z ${size} ${size} ${pngPath} --out ${out}`.quiet();
	if (result.exitCode !== 0) {
		throw new Error(`sips failed for ${label}:\n${result.stderr.toString()}`);
	}
}
