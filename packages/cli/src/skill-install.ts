import { lstat, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readSkillFiles } from "./skill-files.macro" with { type: "macro" };

export const SKILL_NAME = "yoqa-testing";

/** The skill as it was when this CLI was built: relative path → file text. */
export const SKILL_FILES: Record<string, string> = readSkillFiles();

/** Where each agent looks for user-level skills, relative to the home directory. */
export const SKILL_AGENT_DIRS = [
	{ agent: "standard", relative: ".agents/skills" },
	{ agent: "claude", relative: ".claude/skills" },
	{ agent: "cursor", relative: ".cursor/skills" },
	{ agent: "codex", relative: ".codex/skills" },
] as const;

export type SkillLinkStatus =
	/** Points at the store: created now, or already there. */
	| "linked"
	/** Something else is there (a copy, or a link elsewhere) and was left alone. */
	| "kept";

export type SkillLink = {
	agent: (typeof SKILL_AGENT_DIRS)[number]["agent"];
	path: string;
	status: SkillLinkStatus;
};

export type SkillInstallResult = {
	/** The one real copy of the skill. */
	installDir: string;
	files: number;
	/** Empty when installed with `dir`. */
	links: SkillLink[];
};

export type SkillInstallEnv = {
	home?: string;
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
};

/**
 * The store: one real copy that every agent directory links to. On macOS it is the folder the
 * desktop app installs into, so the two installers replace each other's copy instead of
 * leaving two.
 */
export function skillStoreDir(options: SkillInstallEnv = {}): string {
	const home = options.home ?? homedir();
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const data =
		platform === "darwin"
			? join(home, "Library/Application Support")
			: platform === "win32"
				? env.LOCALAPPDATA || join(home, "AppData/Local")
				: env.XDG_DATA_HOME || join(home, ".local/share");
	return join(data, "yoqa/skills", SKILL_NAME);
}

async function writeSkill(dir: string, files: Record<string, string>): Promise<void> {
	await rm(dir, { recursive: true, force: true });
	for (const [path, text] of Object.entries(files)) {
		const target = join(dir, path);
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, text, "utf8");
	}
}

async function pointsAt(link: string, target: string): Promise<boolean> {
	try {
		return (await realpath(link)) === (await realpath(target));
	} catch {
		return false;
	}
}

async function linkAgentDir(path: string, store: string, force: boolean): Promise<SkillLinkStatus> {
	const existing = await lstat(path).catch(() => null);
	if (existing) {
		const ours = existing.isSymbolicLink() && (await pointsAt(path, store));
		if (ours) return "linked";
		if (!force) return "kept";
		await rm(path, { recursive: true, force: true });
	}
	await mkdir(dirname(path), { recursive: true });
	// "junction" lets Windows link a directory without admin rights; other platforms ignore it.
	await symlink(store, path, "junction");
	return "linked";
}

/**
 * Install the skill bundled in this CLI.
 *
 * - Default: write it to the store and link it into every agent's user-level skills directory.
 *   A directory that already holds a different `yoqa-testing` is kept unless `force`.
 * - `dir`: write a plain copy to `<dir>/yoqa-testing` and nothing else — for a project's own
 *   `.claude/skills` or `.agents/skills`.
 */
export async function installSkill(
	options: SkillInstallEnv & {
		dir?: string;
		force?: boolean;
		files?: Record<string, string>;
	} = {},
): Promise<SkillInstallResult> {
	const files = options.files ?? SKILL_FILES;
	if (!files["SKILL.md"]) throw new Error("this yoqa build carries no skill (SKILL.md missing)");
	const count = Object.keys(files).length;

	if (options.dir) {
		const installDir = join(resolve(options.dir), SKILL_NAME);
		await writeSkill(installDir, files);
		return { installDir, files: count, links: [] };
	}

	const home = options.home ?? homedir();
	const installDir = skillStoreDir(options);
	await writeSkill(installDir, files);
	const links: SkillLink[] = [];
	for (const { agent, relative } of SKILL_AGENT_DIRS) {
		const path = join(home, relative, SKILL_NAME);
		links.push({ agent, path, status: await linkAgentDir(path, installDir, !!options.force) });
	}
	return { installDir, files: count, links };
}

export function formatSkillInstall(result: SkillInstallResult): string {
	const lines = [`installed ${SKILL_NAME} (${result.files} files) → ${result.installDir}`];
	for (const link of result.links) {
		lines.push(
			link.status === "linked"
				? `  linked  ${link.path}`
				: `  kept    ${link.path} (not installed by yoqa; --force replaces it)`,
		);
	}
	return lines.join("\n");
}
