/** Electrobun build environment a Release Desktop run builds. */
export type ReleaseChannel = "stable" | "canary";

export type ReleaseBuild = {
	channel: ReleaseChannel;
	/** Only a stable tag build publishes a Yoqa update, so only it must ship a patch. */
	requirePatch: boolean;
	/** `@yoqa/desktop` package script that builds this channel. */
	buildScript: "build:release" | "build:release:canary";
};

/**
 * What a Release Desktop run builds, from its ref (`GITHUB_REF`). Keyed on the ref, not the
 * event, because `publish` runs for any `refs/tags/v*` ref, a manual run on a tag included.
 */
export function releaseBuildFor(ref: string): ReleaseBuild {
	const tag = ref.startsWith("refs/tags/v") ? ref.slice("refs/tags/".length) : null;
	if (tag?.includes("-")) {
		return { channel: "canary", requirePatch: false, buildScript: "build:release:canary" };
	}
	return { channel: "stable", requirePatch: tag !== null, buildScript: "build:release" };
}

/** The platforms Release Desktop builds, in Electrobun's `<os>-<arch>` form. */
export type ReleasePlatform = "macos-arm64" | "win-x64";

/** `app.name` in `electrobun.config.ts`. */
const APP_NAME = "yoqa";

export type ReleaseFiles =
	| {
			ok: true;
			/** Artifact file names to upload and attach to the GitHub Release. */
			files: string[];
			/** The delta patch from the previous release, when Electrobun made one. */
			patch: string | null;
			/** What a person downloads to install by hand. */
			installer: string;
			/** What they open after unpacking it: the `.app` on macOS, the Setup `.exe` on Windows. */
			launch: string;
			warnings: string[];
	  }
	| { ok: false; error: string };

/**
 * Pick a platform's release files out of Electrobun's `artifacts/` folder and check that
 * everything a Yoqa update needs is there. Names follow Electrobun 1.18's flat scheme:
 * `<channel>-<os>-<arch>-<file>`, with `-canary` added to the app's own file names, and the
 * patch named after the previous release's hash (`<prefix>-<hash>.patch`).
 */
export function collectReleaseFiles(input: {
	channel: ReleaseChannel;
	platform: ReleasePlatform;
	requirePatch: boolean;
	artifacts: string[];
}): ReleaseFiles {
	const prefix = `${input.channel}-${input.platform}`;
	const suffix = input.channel === "stable" ? "" : `-${input.channel}`;
	const appFileName = `${APP_NAME}${suffix}`;
	const named =
		input.platform === "macos-arm64"
			? {
					installer: `${prefix}-${appFileName}.dmg`,
					archive: `${prefix}-${appFileName}.app.tar.zst`,
					launch: `${appFileName}.app`,
				}
			: {
					installer: `${prefix}-${APP_NAME}-Setup${suffix}.zip`,
					archive: `${prefix}-${appFileName}.tar.zst`,
					launch: `${APP_NAME}-Setup${suffix}.exe`,
				};
	const required = [named.installer, named.archive, `${prefix}-update.json`];

	const missing = required.filter((name) => !input.artifacts.includes(name));
	if (missing.length > 0) {
		return { ok: false, error: `Missing ${prefix} release files: ${missing.join(", ")}` };
	}

	const patches = input.artifacts.filter(
		(name) => name.startsWith(`${prefix}-`) && name.endsWith(".patch"),
	);
	if (patches.length > 1) {
		return { ok: false, error: `Expected one ${prefix} patch, found ${patches.join(", ")}` };
	}
	const patch = patches[0] ?? null;
	const warnings: string[] = [];
	// Canary never gets a patch: `latest/download` never serves a prerelease's update.json.
	if (patch === null && input.channel === "stable") {
		const why = `No ${prefix} patch: Electrobun could not diff against the latest published release`;
		if (input.requirePatch) {
			return { ok: false, error: `${why}. A stable tag build must publish one.` };
		}
		warnings.push(`${why}. Fine for a build-only run; a stable tag build would fail.`);
	}

	return {
		ok: true,
		files: patch === null ? required : [...required, patch],
		patch,
		installer: named.installer,
		launch: named.launch,
		warnings,
	};
}
