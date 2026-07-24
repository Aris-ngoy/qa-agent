import { cp, lstat, mkdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	CliEnvironmentSnapshot,
	CliInstallState,
	InstallResult,
	InstallSkillResult,
	OpenPathResult,
	SkillTargetId,
	SkillTargetState,
} from "../../../shared/cli-environment";

const APP_SUPPORT = join(homedir(), "Library/Application Support/yoqa");
const SKILL_INSTALL_DIR = join(APP_SUPPORT, "skills/yoqa-testing");
const CLI_WRAPPER_DIR = join(APP_SUPPORT, "bin");
const CLI_WRAPPER_PATH = join(CLI_WRAPPER_DIR, "yoqa");
const PREFERRED_LINK_PATH = join(homedir(), ".local/bin/yoqa");
const DISPLAY_SKILL_DIR = "~/Library/Application Support/yoqa/skills/yoqa-testing";

const SKILL_TARGETS: Array<{
	id: SkillTargetId;
	label: string;
	relative: string;
	displayPath: string;
}> = [
	{
		id: "standard",
		label: "Standard",
		relative: ".agents/skills/yoqa-testing",
		displayPath: "~/.agents/skills/yoqa-testing",
	},
	{
		id: "claude",
		label: "Claude",
		relative: ".claude/skills/yoqa-testing",
		displayPath: "~/.claude/skills/yoqa-testing",
	},
	{
		id: "cursor",
		label: "Cursor",
		relative: ".cursor/skills/yoqa-testing",
		displayPath: "~/.cursor/skills/yoqa-testing",
	},
	{
		id: "codex",
		label: "Codex",
		relative: ".codex/skills/yoqa-testing",
		displayPath: "~/.codex/skills/yoqa-testing",
	},
];

async function pathExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

async function findRepoRoot(): Promise<string | null> {
	const starts = [process.cwd()];
	if (typeof import.meta.dir === "string") {
		starts.push(import.meta.dir);
	}

	for (const start of starts) {
		let dir = start;
		for (let i = 0; i < 14; i++) {
			const marker = join(dir, "services", "runner", "src", "index.ts");
			if (await pathExists(marker)) {
				return dir;
			}
			const parent = dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
	}

	return null;
}

async function resolveSkillSourceDir(): Promise<string | null> {
	const repoRoot = await findRepoRoot();
	if (repoRoot) {
		const packaged = join(repoRoot, "packages/skill/yoqa-testing");
		if (await pathExists(join(packaged, "SKILL.md"))) {
			return packaged;
		}
	}

	const nextToApp = join(import.meta.dir, "../../../../resources/skills/yoqa-testing");
	if (await pathExists(join(nextToApp, "SKILL.md"))) {
		return nextToApp;
	}

	return null;
}

async function resolveCliMainTs(): Promise<string | null> {
	const repoRoot = await findRepoRoot();
	if (!repoRoot) return null;
	const mainTs = join(repoRoot, "services/runner/src/interfaces/cli/main.ts");
	return (await pathExists(mainTs)) ? mainTs : null;
}

function isManagedTarget(target: string | null, resolvedMain: string | null): boolean {
	if (!target) return false;
	if (target === CLI_WRAPPER_PATH) return true;
	if (resolvedMain && target === resolvedMain) return true;
	if (target.startsWith(APP_SUPPORT)) return true;
	return false;
}

async function readSymlinkTarget(path: string): Promise<string | null> {
	try {
		const stats = await lstat(path);
		if (!stats.isSymbolicLink()) return null;
		const link = await readlink(path);
		try {
			return await realpath(path);
		} catch {
			return link;
		}
	} catch {
		return null;
	}
}

async function probeCliState(resolvedMain: string | null): Promise<CliInstallState> {
	const whichYoqa = Bun.which("yoqa");

	try {
		const stats = await lstat(PREFERRED_LINK_PATH);
		const target = stats.isSymbolicLink()
			? ((await readSymlinkTarget(PREFERRED_LINK_PATH)) ?? (await readlink(PREFERRED_LINK_PATH)))
			: PREFERRED_LINK_PATH;

		if (isManagedTarget(target, resolvedMain) || (await isManagedWrapper(PREFERRED_LINK_PATH))) {
			return {
				status: "installed",
				path: PREFERRED_LINK_PATH,
				target: target ?? PREFERRED_LINK_PATH,
				managed: true,
			};
		}

		return {
			status: "foreign",
			path: PREFERRED_LINK_PATH,
			target,
		};
	} catch {
		// preferred link missing
	}

	if (whichYoqa) {
		const target = await readSymlinkTarget(whichYoqa);
		if (isManagedTarget(target ?? whichYoqa, resolvedMain) || (await isManagedWrapper(whichYoqa))) {
			return {
				status: "installed",
				path: whichYoqa,
				target: target ?? whichYoqa,
				managed: true,
			};
		}
		return {
			status: "foreign",
			path: whichYoqa,
			target,
		};
	}

	return { status: "not_installed" };
}

async function isManagedWrapper(path: string): Promise<boolean> {
	try {
		const contents = await Bun.file(path).text();
		return contents.includes("YoQA CLI wrapper") || contents.includes(CLI_WRAPPER_PATH);
	} catch {
		return false;
	}
}

async function probeSkillTarget(target: (typeof SKILL_TARGETS)[number]): Promise<SkillTargetState> {
	const absolute = join(homedir(), target.relative);
	try {
		const stats = await lstat(absolute);
		if (stats.isSymbolicLink()) {
			const pointsTo = await readSymlinkTarget(absolute);
			const linked =
				pointsTo === SKILL_INSTALL_DIR ||
				(pointsTo != null && (await pathsEqual(pointsTo, SKILL_INSTALL_DIR)));
			return {
				id: target.id,
				label: target.label,
				path: absolute,
				displayPath: target.displayPath,
				status: linked ? "linked" : "foreign",
				pointsTo,
			};
		}
		if (stats.isDirectory() || stats.isFile()) {
			return {
				id: target.id,
				label: target.label,
				path: absolute,
				displayPath: target.displayPath,
				status: "copied",
				pointsTo: null,
			};
		}
	} catch {
		// missing
	}

	return {
		id: target.id,
		label: target.label,
		path: absolute,
		displayPath: target.displayPath,
		status: "missing",
		pointsTo: null,
	};
}

async function pathsEqual(a: string, b: string): Promise<boolean> {
	try {
		const ra = await realpath(a);
		const rb = await realpath(b);
		return ra === rb;
	} catch {
		return a === b;
	}
}

function localBinOnPath(): boolean {
	const pathEnv = process.env.PATH ?? "";
	const localBin = join(homedir(), ".local/bin");
	return pathEnv.split(":").some((part) => part === localBin || part === `${localBin}/`);
}

export async function getCliEnvironmentSnapshot(): Promise<CliEnvironmentSnapshot> {
	const [sourceDir, resolvedMain] = await Promise.all([
		resolveSkillSourceDir(),
		resolveCliMainTs(),
	]);
	const bunAvailable = Bun.which("bun") != null;
	const cliState = await probeCliState(resolvedMain);
	const skillInstalled = await pathExists(join(SKILL_INSTALL_DIR, "SKILL.md"));
	const targets = await Promise.all(SKILL_TARGETS.map(probeSkillTarget));

	const pathHint = localBinOnPath()
		? null
		: "Add ~/.local/bin to your PATH so the yoqa command is available in new terminals.";

	return {
		cli: {
			...cliState,
			preferredLinkPath: PREFERRED_LINK_PATH,
			resolvedBinaryTarget: resolvedMain,
			bunAvailable,
			pathHint: cliState.status === "installed" ? null : pathHint,
		},
		skill: {
			sourceDir,
			installDir: SKILL_INSTALL_DIR,
			displayInstallDir: DISPLAY_SKILL_DIR,
			installed: skillInstalled,
			targets,
		},
	};
}

async function writeCliWrapper(mainTs: string): Promise<string> {
	await mkdir(CLI_WRAPPER_DIR, { recursive: true });
	const script = `#!/usr/bin/env bash
# YoQA CLI wrapper — managed by the YoQA desktop app
set -euo pipefail
exec bun "${mainTs}" "$@"
`;
	await writeFile(CLI_WRAPPER_PATH, script, { mode: 0o755 });
	return CLI_WRAPPER_PATH;
}

export async function installCli(): Promise<InstallResult> {
	const mainTs = await resolveCliMainTs();
	if (!mainTs) {
		return {
			ok: false,
			error:
				"Could not find yoqa CLI entrypoint. Open the project from the YoQA repo in development.",
		};
	}

	if (!Bun.which("bun")) {
		return {
			ok: false,
			error: "Bun is required on PATH to run the yoqa CLI.",
		};
	}

	try {
		const wrapper = await writeCliWrapper(mainTs);
		const linkDir = dirname(PREFERRED_LINK_PATH);
		await mkdir(linkDir, { recursive: true });

		try {
			const existing = await lstat(PREFERRED_LINK_PATH);
			if (existing.isSymbolicLink()) {
				const target = await readSymlinkTarget(PREFERRED_LINK_PATH);
				if (!isManagedTarget(target, mainTs) && !(await isManagedWrapper(PREFERRED_LINK_PATH))) {
					return {
						ok: false,
						error: `A different yoqa already exists at ${PREFERRED_LINK_PATH}. Remove it first.`,
					};
				}
				await rm(PREFERRED_LINK_PATH);
			} else if (existing.isFile()) {
				if (!(await isManagedWrapper(PREFERRED_LINK_PATH))) {
					return {
						ok: false,
						error: `A different yoqa already exists at ${PREFERRED_LINK_PATH}. Remove it first.`,
					};
				}
				await rm(PREFERRED_LINK_PATH);
			}
		} catch {
			// nothing at link path
		}

		await symlink(wrapper, PREFERRED_LINK_PATH);
		return { ok: true, path: PREFERRED_LINK_PATH };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}

export async function installSkill(): Promise<InstallSkillResult> {
	const sourceDir = await resolveSkillSourceDir();
	if (!sourceDir) {
		return {
			ok: false,
			error: "Could not find packages/skill/yoqa-testing. Open the YoQA repo or reinstall the app.",
		};
	}

	try {
		await mkdir(dirname(SKILL_INSTALL_DIR), { recursive: true });
		await rm(SKILL_INSTALL_DIR, { recursive: true, force: true });
		await cp(sourceDir, SKILL_INSTALL_DIR, { recursive: true });

		for (const target of SKILL_TARGETS) {
			const absolute = join(homedir(), target.relative);
			await mkdir(dirname(absolute), { recursive: true });

			try {
				const stats = await lstat(absolute);
				if (stats.isSymbolicLink()) {
					const pointsTo = await readSymlinkTarget(absolute);
					const managed =
						pointsTo === SKILL_INSTALL_DIR ||
						(pointsTo != null && (await pathsEqual(pointsTo, SKILL_INSTALL_DIR)));
					if (!managed) {
						continue; // leave foreign links alone
					}
					await rm(absolute);
				} else {
					// Do not replace copied/foreign directories
					continue;
				}
			} catch {
				// missing — create link
			}

			await symlink(SKILL_INSTALL_DIR, absolute);
		}

		const targets = await Promise.all(SKILL_TARGETS.map(probeSkillTarget));
		return { ok: true, installDir: SKILL_INSTALL_DIR, targets };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}

export async function openSkillFolder(): Promise<OpenPathResult> {
	try {
		await mkdir(SKILL_INSTALL_DIR, { recursive: true });
		if (!(await pathExists(join(SKILL_INSTALL_DIR, "SKILL.md")))) {
			const sourceDir = await resolveSkillSourceDir();
			if (sourceDir) {
				await cp(sourceDir, SKILL_INSTALL_DIR, { recursive: true });
			}
		}
		const proc = Bun.spawn(["open", SKILL_INSTALL_DIR], {
			stdout: "ignore",
			stderr: "ignore",
		});
		const code = await proc.exited;
		if (code !== 0) {
			return { ok: false, error: `open exited with code ${code}` };
		}
		return { ok: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, error: message };
	}
}
