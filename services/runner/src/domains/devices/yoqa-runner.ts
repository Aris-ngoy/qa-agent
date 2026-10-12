/**
 * `YoqaRunner` (source in `native/yoqa-runner`): the XCUITest runner for a cabled iPhone, the
 * physical-iOS Direct implementation. Its UI-test method binds 127.0.0.1 on the phone and
 * announces `YOQA_RUNNER_LISTENING port=N`.
 *
 * It must be signed before anything runs: automatic signing for the team of the newest Apple
 * Development identity in the keychain (`YOQA_IOS_TEAM_ID` overrides), built once with
 * `xcodebuild build-for-testing` and cached by source hash, Xcode version and team.
 */

import { X509Certificate, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

export type RunnerExecResult = { stdout: string; stderr: string; exitCode: number };

/** Runs a command to completion. */
export type RunnerExec = (command: string[]) => Promise<RunnerExecResult>;

export type YoqaRunnerDeps = {
	exec: RunnerExec;
	env: Record<string, string | undefined>;
	/** `native/yoqa-runner`. */
	projectDir: string;
	/** Where builds are cached, one derived-data directory per cache key. */
	cacheRoot: string;
	now: () => Date;
};

export type YoqaRunnerBuild = {
	team: string;
	/** The `.xctestrun` that `xcodebuild test-without-building` runs. */
	xctestrun: string;
	action: "built" | "reused";
};

/** The runner could not be signed, built or started; the message says what to fix. */
export class YoqaRunnerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "YoqaRunnerError";
	}
}

type Identity = { team: string; issuedAt: number };

/**
 * Valid Apple Development identities: certificates from `find-certificate` whose SHA-1 is
 * listed by `find-identity -v` (so the private key is in the keychain) without a
 * `CSSMERR_…` suffix, and that have not expired. The team is the certificate's OU.
 */
export function readSigningIdentities(
	findIdentity: string,
	findCertificate: string,
	now: Date,
): Identity[] {
	const usable = new Set<string>();
	for (const line of findIdentity.split("\n")) {
		const match = line.match(/^\s*\d+\)\s+([0-9A-F]{40})\s+"Apple Development:[^"]*"\s*$/);
		if (match?.[1]) usable.add(match[1]);
	}
	const identities: Identity[] = [];
	const certificates = findCertificate.matchAll(
		/SHA-1 hash:\s*([0-9A-F]{40})\s*(-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----)/g,
	);
	for (const [, hash, pem] of certificates) {
		if (!hash || !pem || !usable.has(hash)) continue;
		let certificate: X509Certificate;
		try {
			certificate = new X509Certificate(pem);
		} catch {
			continue;
		}
		const team = certificate.subject.match(/^OU=(.+)$/m)?.[1]?.trim();
		const issuedAt = Date.parse(certificate.validFrom);
		if (!team || Date.parse(certificate.validTo) <= now.getTime()) continue;
		identities.push({ team, issuedAt });
	}
	return identities;
}

async function signingTeam(deps: YoqaRunnerDeps): Promise<string> {
	const override = deps.env.YOQA_IOS_TEAM_ID?.trim().toUpperCase();
	if (override) return override;
	const [identity, certificate] = await Promise.all([
		deps.exec(["security", "find-identity", "-v", "-p", "codesigning"]),
		deps.exec(["security", "find-certificate", "-a", "-Z", "-p", "-c", "Apple Development"]),
	]);
	const newest = readSigningIdentities(identity.stdout, certificate.stdout, deps.now()).sort(
		(a, b) => b.issuedAt - a.issuedAt,
	)[0];
	if (!newest) {
		throw new YoqaRunnerError(
			"No Apple Development signing identity in the keychain. Sign in to Xcode › Settings › Accounts with your Apple ID (a free account works), or set YOQA_IOS_TEAM_ID.",
		);
	}
	return newest.team;
}

/** What the build depends on, besides the team. Tests and SwiftPM state are not built. */
const SOURCE_ENTRIES = ["YoqaRunner", "YoqaRunnerUITests", "Sources", "YoqaRunner.xcodeproj"];
const IGNORED = new Set(["xcuserdata", ".build", ".swiftpm", "DerivedData", ".DS_Store"]);

async function hashSources(projectDir: string): Promise<string> {
	const hash = createHash("sha256");
	const visit = async (path: string): Promise<void> => {
		let entries: string[];
		try {
			entries = (await readdir(path)).sort();
		} catch {
			hash.update(`${relative(projectDir, path)}\0`);
			hash.update(await readFile(path));
			return;
		}
		for (const entry of entries) {
			if (!IGNORED.has(entry)) await visit(join(path, entry));
		}
	};
	for (const entry of SOURCE_ENTRIES) {
		const path = join(projectDir, entry);
		if (existsSync(path)) await visit(path);
	}
	return hash.digest("hex");
}

/** Bump when the steps after `build-for-testing` change, so older cached builds redo them. */
const MANIFEST_VERSION = 2;

type Manifest = {
	/** Absent before the runner app was branded (version 2). */
	version?: number;
	team: string;
	xctestrun: string;
	/** The earliest provisioning-profile expiry in the build (a free profile lasts about 7 days). */
	profileExpiresAt: string;
	/** The phones every profile lists, or null when a profile provisions all devices. */
	devices: string[] | null;
};

type Profile = { expiresAt: number; devices: string[] | null };

/** `ExpirationDate` and `ProvisionedDevices` from a decoded `.mobileprovision` plist. */
function parseProfile(plist: string): Profile | null {
	const expires = plist.match(/<key>ExpirationDate<\/key>\s*<date>([^<]+)<\/date>/)?.[1];
	const expiresAt = expires ? Date.parse(expires) : Number.NaN;
	if (Number.isNaN(expiresAt)) return null;
	if (/<key>ProvisionsAllDevices<\/key>\s*<true\/>/.test(plist))
		return { expiresAt, devices: null };
	const list =
		plist.match(/<key>ProvisionedDevices<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ?? "";
	return {
		expiresAt,
		devices: [...list.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1] ?? ""),
	};
}

/** The profiles embedded in the built apps, read back with `security cms`. */
async function readProfiles(products: string, exec: RunnerExec): Promise<Profile[]> {
	const platform = join(products, "Debug-iphoneos");
	const apps = (await readdir(platform).catch(() => [] as string[])).filter((name) =>
		name.endsWith(".app"),
	);
	const profiles: Profile[] = [];
	for (const app of apps) {
		const path = join(platform, app, "embedded.mobileprovision");
		if (!existsSync(path)) continue;
		const decoded = await exec(["security", "cms", "-D", "-i", path]);
		const profile = decoded.exitCode === 0 ? parseProfile(decoded.stdout) : null;
		if (profile) profiles.push(profile);
	}
	return profiles;
}

function usableFor(manifest: Manifest, udid: string, now: Date): boolean {
	return (
		manifest.version === MANIFEST_VERSION &&
		existsSync(manifest.xctestrun) &&
		Date.parse(manifest.profileExpiresAt) > now.getTime() &&
		(manifest.devices === null || manifest.devices.includes(udid))
	);
}

async function readManifest(path: string): Promise<Manifest | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as Manifest;
	} catch {
		return null;
	}
}

async function findXctestrun(products: string): Promise<string | null> {
	const entries = await readdir(products).catch(() => [] as string[]);
	const name = entries.find((entry) => entry.endsWith(".xctestrun"));
	return name ? join(products, name) : null;
}

/**
 * Gives `YoqaRunnerUITests-Runner.app` the host app's icon. Xcode copies the runner from its
 * XCTRunner template after the UI-test target's build phases, so no build setting reaches it:
 * the compiled AppIcon and its `CFBundleIcons` are copied in, and the runner is re-signed with
 * the certificate Xcode signed it with, keeping its identifier and entitlements.
 *
 * The icon is cosmetic, so the work happens on a copy that replaces the runner only once it is
 * signed. Returns why branding was skipped, or null.
 */
async function brandRunnerApp(products: string, exec: RunnerExec): Promise<string | null> {
	const platform = join(products, "Debug-iphoneos");
	const host = join(platform, "YoqaRunner.app");
	const runner = join(platform, "YoqaRunnerUITests-Runner.app");
	const staging = join(products, "branding");
	const copy = join(staging, "YoqaRunnerUITests-Runner.app");
	const run = async (command: string[]): Promise<string> => {
		const result = await exec(command);
		if (result.exitCode !== 0) {
			throw new Error(
				`${command.slice(0, 2).join(" ")}: ${(result.stderr || result.stdout).trim()}`,
			);
		}
		return result.stdout;
	};
	try {
		const icons = (await readdir(host)).filter(
			(name) => name.startsWith("AppIcon") || name === "Assets.car",
		);
		if (!icons.some((name) => name.startsWith("AppIcon"))) return "the host app has no AppIcon";
		await rm(staging, { recursive: true, force: true });
		await cp(runner, copy, { recursive: true, verbatimSymlinks: true });
		for (const name of icons) await copyFile(join(host, name), join(copy, name));
		const plist = await run([
			"plutil",
			"-extract",
			"CFBundleIcons",
			"json",
			"-o",
			"-",
			join(host, "Info.plist"),
		]);
		await run([
			"plutil",
			"-insert",
			"CFBundleIcons",
			"-json",
			plist.trim(),
			join(copy, "Info.plist"),
		]);
		const certificates = join(staging, "certificate");
		await run(["codesign", "-d", `--extract-certificates=${certificates}`, runner]);
		const identity = createHash("sha1")
			.update(await readFile(`${certificates}0`))
			.digest("hex")
			.toUpperCase();
		await run([
			"codesign",
			"--force",
			"--sign",
			identity,
			"--preserve-metadata=identifier,entitlements,flags,runtime",
			"--generate-entitlement-der",
			copy,
		]);
		const unbranded = join(staging, "unbranded.app");
		await rename(runner, unbranded);
		try {
			await rename(copy, runner);
		} catch (error) {
			await rename(unbranded, runner);
			throw error;
		}
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	} finally {
		await rm(staging, { recursive: true, force: true });
	}
}

/** `xcodebuild -version`, which is part of the cache key. */
function xcodeVersion(result: RunnerExecResult): string {
	const version = result.stdout.trim();
	if (result.exitCode !== 0 || !version) {
		throw new YoqaRunnerError(
			`xcodebuild -version failed, so YoqaRunner cannot be built: ${(result.stderr || result.stdout).trim() || `exit ${result.exitCode}`}. Install Xcode and select it with xcode-select.`,
		);
	}
	return version;
}

/** Per team, so two teams on one Mac never fight over one App ID. */
function bundleIdFor(team: string): string {
	return `dev.yoqa.runner.${team.toLowerCase()}`;
}

/** The `error:` lines of an xcodebuild log, without their file prefix and target suffix. */
function xcodebuildErrors(output: string): string[] {
	const errors = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => /(^|:\s)error:/i.test(line))
		.map((line) =>
			line
				.replace(/^.*?error:\s*/i, "")
				.replace(/\s*\(in target '[^']*' from project '[^']*'\)$/, ""),
		);
	return [...new Set(errors)].filter(Boolean);
}

/** What went wrong while signing or building, and what the user does about it. */
export function explainBuildFailure(
	output: string,
	team: string,
	what = "could not be built",
): string {
	const errors = xcodebuildErrors(output);
	// A device-prep wait (locked phone, Developer Mode) is an NSError, not an `error:` line.
	const nsError = output.match(/Error Domain=\S+ Code=-?\d+ "([^"]+)"/)?.[1];
	const detail =
		errors.slice(0, 2).join(" ") ||
		(nsError ? `${nsError}.` : output.trim().split("\n").slice(-5).join(" "));
	const fix = (() => {
		if (/device is locked|Unlock .* to Continue/i.test(output)) {
			return "Unlock the iPhone, keep it unlocked, then connect again.";
		}
		if (/Untrusted Developer|is not trusted|not been explicitly trusted/i.test(output)) {
			return "Trust the developer on the iPhone in Settings › General › VPN & Device Management, then connect again.";
		}
		if (/Developer Mode/i.test(output)) {
			return "Turn on Developer Mode in Settings › Privacy & Security › Developer Mode on the iPhone, then connect again.";
		}
		if (/No Accounts?(?: for Team|:| found| with)|not signed in/i.test(output)) {
			return `Xcode has no account for team ${team}. Sign in with that team's Apple ID in Xcode › Settings › Accounts, or set YOQA_IOS_TEAM_ID to a team you are signed in to.`;
		}
		if (
			/cannot be registered|is not available|Failed Registering Bundle Identifier/i.test(output)
		) {
			return `The App ID ${bundleIdFor(team)} is not available to team ${team}. Set YOQA_IOS_TEAM_ID to the team that registered it.`;
		}
		if (
			/No (?:signing certificate|profiles? for)|requires a provisioning profile|Provisioning profile/i.test(
				output,
			)
		) {
			return `Team ${team} has no usable development certificate or profile. Open Xcode › Settings › Accounts, select the team and choose Manage Certificates, or set YOQA_IOS_TEAM_ID.`;
		}
		return `Check that team ${team} can sign for this iPhone in Xcode, or set YOQA_IOS_TEAM_ID.`;
	})();
	return `YoqaRunner ${what} for team ${team}: ${detail} ${fix}`;
}

/** Sign and build the runner for this phone, or reuse the cached build. */
export async function prepareYoqaRunner(
	udid: string,
	deps: YoqaRunnerDeps,
): Promise<YoqaRunnerBuild> {
	const team = await signingTeam(deps);
	const [sources, xcode] = await Promise.all([
		hashSources(deps.projectDir),
		deps.exec(["xcodebuild", "-version"]),
	]);
	const key = createHash("sha256")
		.update(`${sources}\0${xcodeVersion(xcode)}\0${team}`)
		.digest("hex")
		.slice(0, 16);
	const dir = join(deps.cacheRoot, key);
	const manifestPath = join(dir, "build.json");

	const cached = await readManifest(manifestPath);
	if (cached && usableFor(cached, udid, deps.now())) {
		return { team: cached.team, xctestrun: cached.xctestrun, action: "reused" };
	}

	const derivedData = join(dir, "DerivedData");
	const build = await deps.exec([
		"xcodebuild",
		"build-for-testing",
		"-project",
		join(deps.projectDir, "YoqaRunner.xcodeproj"),
		"-scheme",
		"YoqaRunner",
		"-destination",
		`id=${udid}`,
		"-derivedDataPath",
		derivedData,
		"-allowProvisioningUpdates",
		"-allowProvisioningDeviceRegistration",
		`DEVELOPMENT_TEAM=${team}`,
		`YOQA_RUNNER_BUNDLE_ID=${bundleIdFor(team)}`,
		"CODE_SIGN_STYLE=Automatic",
	]);
	if (build.exitCode !== 0) {
		throw new YoqaRunnerError(explainBuildFailure(`${build.stdout}\n${build.stderr}`, team));
	}
	const products = join(derivedData, "Build/Products");
	const unbranded = await brandRunnerApp(products, deps.exec);
	if (unbranded) console.warn(`[yoqa-runner] the runner keeps Xcode's blank icon: ${unbranded}`);
	const xctestrun = await findXctestrun(products);
	const profiles = await readProfiles(products, deps.exec);
	if (!xctestrun || profiles.length === 0) {
		throw new Error(`YoqaRunner built, but no signed .xctestrun under ${products}`);
	}
	const restricted = profiles.flatMap((profile) => (profile.devices ? [profile.devices] : []));
	const manifest: Manifest = {
		version: MANIFEST_VERSION,
		team,
		xctestrun,
		profileExpiresAt: new Date(Math.min(...profiles.map((p) => p.expiresAt))).toISOString(),
		devices:
			restricted.length === 0
				? null
				: (restricted[0] ?? []).filter((device) =>
						restricted.every((list) => list.includes(device)),
					),
	};
	await mkdir(dir, { recursive: true });
	await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
	return { team, xctestrun, action: "built" };
}

/** The `xcodebuild test-without-building` process that hosts the runner. */
export type RunnerProcess = {
	stdout: ReadableStream<Uint8Array>;
	stderr?: ReadableStream<Uint8Array>;
	exited: Promise<number>;
	kill: (signal?: NodeJS.Signals) => void;
};

export type StartYoqaRunnerDeps = YoqaRunnerDeps & {
	spawn: (command: string[], env: Record<string, string>) => RunnerProcess;
	/** How long the phone gets to launch the runner. The first launch installs it. */
	readyTimeoutMs?: number;
};

/** A runner listening on the phone's loopback. Reaching `port` from the Mac needs usbmuxd. */
export type YoqaRunner = {
	/** The device-side port, from `YOQA_RUNNER_LISTENING port=N`. */
	port: number;
	build: YoqaRunnerBuild;
	/** Resolves when the runner (its xcodebuild) is gone. */
	exited: Promise<number>;
	/** Stop it. Safe to call twice. */
	stop: () => Promise<void>;
};

const READY_TIMEOUT_MS = 120_000;
const LISTENING_RE = /YOQA_RUNNER_LISTENING port=(\d+)/;
const OUTPUT_TAIL_CHARS = 16_000;

/**
 * Reads a stream to its end, keeping its tail, and calls `onLine` per line. It keeps
 * draining after the runner is up so xcodebuild never blocks on a full pipe.
 */
function drain(stream: ReadableStream<Uint8Array> | undefined, onLine: (line: string) => void) {
	let tail = "";
	const done = (async () => {
		if (!stream) return;
		const decoder = new TextDecoder();
		let buffered = "";
		for await (const chunk of stream) {
			const text = decoder.decode(chunk, { stream: true });
			tail = (tail + text).slice(-OUTPUT_TAIL_CHARS);
			buffered += text;
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			for (const line of lines) onLine(line);
		}
		if (buffered) onLine(buffered);
	})().catch(() => undefined);
	return { done, tail: () => tail };
}

/** Build (or reuse) the runner, launch it on the phone, and resolve once it listens. */
export async function startYoqaRunner(
	udid: string,
	deps: StartYoqaRunnerDeps,
): Promise<YoqaRunner> {
	const build = await prepareYoqaRunner(udid, deps);
	const readyTimeoutMs = deps.readyTimeoutMs ?? READY_TIMEOUT_MS;
	const env: Record<string, string> = {};
	const port = deps.env.YOQA_RUNNER_PORT?.trim();
	if (port) env.TEST_RUNNER_YOQA_RUNNER_PORT = port;
	const child = deps.spawn(
		[
			"xcodebuild",
			"test-without-building",
			"-xctestrun",
			build.xctestrun,
			"-destination",
			`id=${udid}`,
			"-only-testing:YoqaRunnerUITests/RunnerTests/testServe",
		],
		env,
	);

	let stopped = false;
	const stop = async () => {
		if (stopped) return;
		stopped = true;
		child.kill("SIGTERM");
		await child.exited;
	};

	let announce: (port: number) => void = () => undefined;
	const announced = new Promise<number>((resolve) => {
		announce = resolve;
	});
	const onLine = (line: string) => {
		const match = line.match(LISTENING_RE);
		if (match?.[1]) announce(Number(match[1]));
	};
	const stdout = drain(child.stdout, onLine);
	const stderr = drain(child.stderr, onLine);
	const output = () => `${stdout.tail()}\n${stderr.tail()}`;

	let timer: ReturnType<typeof setTimeout> | undefined;
	const outcome = await Promise.race([
		announced.then((value) => ({ port: value })),
		child.exited.then(async () => {
			await Promise.all([stdout.done, stderr.done]);
			return { exited: true } as const;
		}),
		new Promise<{ timedOut: true }>((resolve) => {
			timer = setTimeout(() => resolve({ timedOut: true }), readyTimeoutMs);
		}),
	]);
	clearTimeout(timer);

	if ("port" in outcome) return { port: outcome.port, build, exited: child.exited, stop };
	await stop();
	if ("exited" in outcome) {
		throw new YoqaRunnerError(explainBuildFailure(output(), build.team, "could not start"));
	}
	throw new YoqaRunnerError(
		explainBuildFailure(
			output(),
			build.team,
			`did not print YOQA_RUNNER_LISTENING within ${readyTimeoutMs} ms`,
		),
	);
}

async function execCommand(command: string[]): Promise<RunnerExecResult> {
	try {
		const proc = Bun.spawn(command, {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, exitCode };
	} catch {
		return { stdout: "", stderr: `failed to spawn: ${command[0]}`, exitCode: 127 };
	}
}

/** The real Mac: the keychain, xcodebuild, `~/.yoqa/yoqa-runner`, and `native/yoqa-runner`. */
export function yoqaRunnerDeps(): StartYoqaRunnerDeps {
	return {
		exec: execCommand,
		spawn: (command, env) =>
			Bun.spawn(command, {
				env: { ...process.env, ...env },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			}),
		env: process.env,
		projectDir: join(import.meta.dir, "../../../../../native/yoqa-runner"),
		cacheRoot: join(homedir(), ".yoqa", "yoqa-runner"),
		now: () => new Date(),
	};
}
