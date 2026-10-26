/**
 * Embed assets/icon.ico into the Windows app exes (electrobun `scripts.postBuild`).
 *
 * electrobun 1.18 tries this itself, but its compiled CLI resolves `rcedit` from the path
 * it was built on (`D:\a\electrobun\…`), so it fails and the app keeps Bun's icon in
 * Explorer and the taskbar. rcedit is an electrobun dependency, so resolve it from there.
 * Runs after electrobun's own attempt and before the bundle is packed for the installer.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

if (process.env.ELECTROBUN_OS !== "win") process.exit(0);

const desktopRoot = resolve(import.meta.dir, "..");
const iconPath = join(desktopRoot, "assets/icon.ico");
const buildDir = process.env.ELECTROBUN_BUILD_DIR;
const appName = process.env.ELECTROBUN_APP_NAME;
if (!buildDir || !appName) {
	throw new Error("ELECTROBUN_BUILD_DIR and ELECTROBUN_APP_NAME must be set by electrobun");
}

const fromElectrobun = createRequire(
	createRequire(import.meta.url).resolve("electrobun/package.json"),
);
const rceditDir = dirname(fromElectrobun.resolve("rcedit/package.json"));
const rcedit = [
	join(rceditDir, "bin", "rcedit-x64.exe"),
	join(rceditDir, "bin", "rcedit.exe"),
].find(existsSync);
if (!rcedit) throw new Error(`rcedit binary not found under ${rceditDir}`);

const binDir = join(buildDir, appName, "bin");
for (const exe of ["launcher.exe", "bun.exe"]) {
	const target = join(binDir, exe);
	if (!existsSync(target)) {
		console.warn(`[yoqa desktop] icon: ${target} missing, skipped`);
		continue;
	}
	execFileSync(rcedit, [target, "--set-icon", iconPath]);
	console.log(`[yoqa desktop] icon embedded into ${target}`);
}
