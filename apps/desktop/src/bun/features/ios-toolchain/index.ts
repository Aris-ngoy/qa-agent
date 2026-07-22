import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type {
	IosToolchainPreferences,
	IosToolchainSnapshot,
	SigningIdentity,
	SigningTier,
	XcodeInstallation,
} from "../../../shared/ios-toolchain";

const PREFS_DIR = join(homedir(), "Library/Application Support/yoqa");
const PREFS_PATH = join(PREFS_DIR, "settings.json");

type StoredSettings = {
	ios?: Partial<IosToolchainPreferences>;
};

async function runCommand(
	command: string[],
	options?: { cwd?: string; env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn(command, {
		cwd: options?.cwd,
		env: options?.env ? { ...process.env, ...options.env } : process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { stdout, stderr, exitCode };
}

async function readPreferences(): Promise<IosToolchainPreferences> {
	try {
		const raw = await readFile(PREFS_PATH, "utf8");
		const parsed = JSON.parse(raw) as StoredSettings;
		return {
			xcodeDeveloperDir: parsed.ios?.xcodeDeveloperDir ?? null,
			signingIdentityHash: parsed.ios?.signingIdentityHash ?? null,
		};
	} catch {
		return { xcodeDeveloperDir: null, signingIdentityHash: null };
	}
}

async function writePreferences(prefs: IosToolchainPreferences): Promise<void> {
	await mkdir(PREFS_DIR, { recursive: true });
	let existing: StoredSettings = {};
	try {
		existing = JSON.parse(await readFile(PREFS_PATH, "utf8")) as StoredSettings;
	} catch {
		// First write
	}
	const next: StoredSettings = {
		...existing,
		ios: {
			...existing.ios,
			...prefs,
		},
	};
	await writeFile(PREFS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function getXcodeSelectPath(): Promise<string | null> {
	const { stdout, exitCode } = await runCommand(["xcode-select", "-p"]);
	if (exitCode !== 0) return null;
	const path = stdout.trim();
	return path.length > 0 ? path : null;
}

async function discoverXcodeAppPaths(): Promise<string[]> {
	const found = new Set<string>();

	const { stdout } = await runCommand([
		"mdfind",
		"kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'",
	]);
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.endsWith(".app")) found.add(trimmed);
	}

	const glob = new Bun.Glob("Xcode*.app");
	for await (const match of glob.scan({ cwd: "/Applications", onlyFiles: false })) {
		found.add(join("/Applications", match));
	}

	return [...found].sort();
}

async function readXcodeVersion(appPath: string): Promise<string> {
	const { stdout, exitCode } = await runCommand([
		"defaults",
		"read",
		join(appPath, "Contents/Info"),
		"CFBundleShortVersionString",
	]);
	if (exitCode === 0 && stdout.trim()) return stdout.trim();

	const xcodebuild = join(appPath, "Contents/Developer/usr/bin/xcodebuild");
	const version = await runCommand([xcodebuild, "-version"]);
	const match = version.stdout.match(/Xcode\s+([^\s]+)/);
	return match?.[1] ?? "unknown";
}

function developerDirForApp(appPath: string): string {
	return join(appPath, "Contents/Developer");
}

async function listXcodeInstallations(
	preferredDeveloperDir: string | null,
): Promise<XcodeInstallation[]> {
	const selectedPath = await getXcodeSelectPath();
	const appPaths = await discoverXcodeAppPaths();

	const installations = await Promise.all(
		appPaths.map(async (appPath) => {
			const developerDir = developerDirForApp(appPath);
			const version = await readXcodeVersion(appPath);
			const appName = basename(appPath);
			return {
				id: developerDir,
				appPath,
				appName,
				version,
				developerDir,
				isSelected: false,
			} satisfies XcodeInstallation;
		}),
	);

	const preferred =
		(preferredDeveloperDir &&
			installations.find((item) => item.developerDir === preferredDeveloperDir)) ||
		(selectedPath && installations.find((item) => item.developerDir === selectedPath)) ||
		installations[0];

	return installations.map((item) => ({
		...item,
		isSelected: preferred ? item.developerDir === preferred.developerDir : false,
	}));
}

type ParsedIdentityLine = {
	hash: string;
	name: string;
	valid: boolean;
};

function parseIdentityLines(output: string): ParsedIdentityLine[] {
	const results: ParsedIdentityLine[] = [];
	for (const line of output.split("\n")) {
		const match = line.match(/^\s*\d+\)\s+([A-F0-9]+)\s+"([^"]+)"(.*)$/i);
		if (!match) continue;
		const hash = match[1] ?? "";
		const name = match[2] ?? "";
		const suffix = match[3] ?? "";
		if (!hash || !name) continue;
		const valid = !/CSSMERR_/i.test(suffix);
		results.push({ hash, name, valid });
	}
	return results;
}

async function readCertificateSubject(name: string): Promise<string | null> {
	const pem = await runCommand(["security", "find-certificate", "-c", name, "-p"]);
	if (pem.exitCode !== 0 || !pem.stdout.includes("BEGIN CERTIFICATE")) {
		return null;
	}
	const proc = Bun.spawn(["openssl", "x509", "-noout", "-subject"], {
		stdin: new Blob([pem.stdout]),
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (exitCode !== 0) return null;
	return stdout.trim();
}

function subjectField(subject: string, key: string): string | null {
	const match = subject.match(new RegExp(`/${key}=([^/]+)`));
	return match?.[1]?.trim() ?? null;
}

function isCorporateOrganization(organization: string): boolean {
	return /\b(GmbH|Inc\.?|LLC|Ltd\.?|Corp\.?|Limited|Company|AG|SAS|B\.?V\.?|Oy|Studios|Technologies|Software|Apps)\b/i.test(
		organization,
	);
}

function classifyTier(
	organization: string,
	teamId: string,
	distributionTeamIds: Set<string>,
): SigningTier {
	if (distributionTeamIds.has(teamId) || isCorporateOrganization(organization)) {
		return "Paid";
	}
	return "Personal";
}

function isDevelopmentIdentity(name: string): boolean {
	return /^Apple Development:/i.test(name) || /^iPhone Developer:/i.test(name);
}

function isDistributionIdentity(name: string): boolean {
	return /Distribution:/i.test(name);
}

async function listSigningIdentities(): Promise<SigningIdentity[]> {
	const { stdout, exitCode } = await runCommand([
		"security",
		"find-identity",
		"-v",
		"-p",
		"codesigning",
	]);
	if (exitCode !== 0) return [];

	const parsed = parseIdentityLines(stdout).filter((item) => item.valid);
	const distributionTeamIds = new Set<string>();
	const development: Array<ParsedIdentityLine & { teamId: string; organization: string }> = [];

	for (const item of parsed) {
		const subject = await readCertificateSubject(item.name);
		const teamId = subject ? subjectField(subject, "OU") : null;
		const organization = subject ? subjectField(subject, "O") : null;
		if (!teamId || !organization) continue;

		if (isDistributionIdentity(item.name)) {
			distributionTeamIds.add(teamId);
			continue;
		}
		if (!isDevelopmentIdentity(item.name)) continue;

		development.push({
			...item,
			teamId,
			organization,
		});
	}

	const identities: SigningIdentity[] = development.map((item) => {
		const tier = classifyTier(item.organization, item.teamId, distributionTeamIds);
		return {
			id: item.hash,
			hash: item.hash,
			name: item.name,
			teamId: item.teamId,
			organization: item.organization,
			tier,
			label: `${item.teamId} ${item.name}`,
		};
	});

	return identities;
}

export async function getIosToolchainSnapshot(): Promise<IosToolchainSnapshot> {
	const preferences = await readPreferences();
	const [xcodes, identities] = await Promise.all([
		listXcodeInstallations(preferences.xcodeDeveloperDir),
		listSigningIdentities(),
	]);

	const selectedXcode = xcodes.find((item) => item.isSelected) ?? null;
	const selectedIdentity =
		(preferences.signingIdentityHash &&
			identities.find((item) => item.hash === preferences.signingIdentityHash)) ||
		identities.find((item) => item.tier === "Paid") ||
		identities[0] ||
		null;

	const resolved: IosToolchainPreferences = {
		xcodeDeveloperDir: selectedXcode?.developerDir ?? preferences.xcodeDeveloperDir,
		signingIdentityHash: selectedIdentity?.hash ?? preferences.signingIdentityHash,
	};

	// Persist resolved defaults so later runner install can read them
	if (
		resolved.xcodeDeveloperDir !== preferences.xcodeDeveloperDir ||
		resolved.signingIdentityHash !== preferences.signingIdentityHash
	) {
		await writePreferences(resolved);
	}

	return {
		xcodes,
		identities,
		preferences: resolved,
	};
}

export async function setIosToolchainSelection(params: {
	xcodeDeveloperDir?: string | null;
	signingIdentityHash?: string | null;
}): Promise<IosToolchainPreferences> {
	const current = await readPreferences();
	const next: IosToolchainPreferences = {
		xcodeDeveloperDir:
			params.xcodeDeveloperDir === undefined ? current.xcodeDeveloperDir : params.xcodeDeveloperDir,
		signingIdentityHash:
			params.signingIdentityHash === undefined
				? current.signingIdentityHash
				: params.signingIdentityHash,
	};
	await writePreferences(next);
	return next;
}
