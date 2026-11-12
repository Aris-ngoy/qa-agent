import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
	SKILL_AGENT_DIRS,
	SKILL_FILES,
	formatSkillInstall,
	installSkill,
	skillStoreDir,
} from "./skill-install";

const shipped = join(import.meta.dir, "../../skill/yoqa-testing");

async function listFiles(dir: string, root = dir): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await listFiles(path, root)));
		else out.push(relative(root, path));
	}
	return out.sort();
}

let home: string;
const at = () => ({ home, platform: "linux" as const, env: {} });

beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "yoqa-skill-"));
});
afterEach(async () => {
	await rm(home, { recursive: true, force: true });
});

describe("the skill bundled in the CLI", () => {
	test("is the shipped skill, file for file", async () => {
		const onDisk = await listFiles(shipped);
		expect(Object.keys(SKILL_FILES).sort()).toEqual(onDisk);
		for (const path of onDisk) {
			expect(SKILL_FILES[path]).toBe(await readFile(join(shipped, path), "utf8"));
		}
	});
});

describe("skillStoreDir", () => {
	test("macOS shares the desktop app's folder", () => {
		expect(skillStoreDir({ home: "/Users/ada", platform: "darwin", env: {} })).toBe(
			"/Users/ada/Library/Application Support/yoqa/skills/yoqa-testing",
		);
	});

	test("Linux follows XDG_DATA_HOME, defaulting to ~/.local/share", () => {
		expect(skillStoreDir({ home: "/home/ada", platform: "linux", env: {} })).toBe(
			"/home/ada/.local/share/yoqa/skills/yoqa-testing",
		);
		expect(
			skillStoreDir({ home: "/home/ada", platform: "linux", env: { XDG_DATA_HOME: "/data" } }),
		).toBe("/data/yoqa/skills/yoqa-testing");
	});
});

describe("installSkill", () => {
	test("writes the store and links every agent directory to it", async () => {
		const result = await installSkill(at());

		expect(result.installDir).toBe(join(home, ".local/share/yoqa/skills/yoqa-testing"));
		expect(await listFiles(result.installDir)).toEqual(Object.keys(SKILL_FILES).sort());
		expect(result.links.map((link) => link.status)).toEqual(SKILL_AGENT_DIRS.map(() => "linked"));
		for (const link of result.links) {
			expect((await lstat(link.path)).isSymbolicLink()).toBe(true);
			expect(await readFile(join(link.path, "SKILL.md"), "utf8")).toBe(SKILL_FILES["SKILL.md"]);
		}
	});

	test("a second install replaces the store and drops files the skill no longer has", async () => {
		const first = await installSkill(at());
		await writeFile(join(first.installDir, "stale.md"), "old");

		const second = await installSkill(at());

		expect(await listFiles(second.installDir)).toEqual(Object.keys(SKILL_FILES).sort());
		expect(second.links.every((link) => link.status === "linked")).toBe(true);
	});

	test("keeps a yoqa-testing it did not install, and replaces it with force", async () => {
		const foreign = join(home, ".claude/skills/yoqa-testing");
		await mkdir(foreign, { recursive: true });
		await writeFile(join(foreign, "SKILL.md"), "someone else's copy");

		const kept = await installSkill(at());
		expect(kept.links.find((link) => link.agent === "claude")?.status).toBe("kept");
		expect(await readFile(join(foreign, "SKILL.md"), "utf8")).toBe("someone else's copy");
		expect(formatSkillInstall(kept)).toContain(`kept    ${foreign}`);

		const forced = await installSkill({ ...at(), force: true });
		expect(forced.links.find((link) => link.agent === "claude")?.status).toBe("linked");
		expect(await readFile(join(foreign, "SKILL.md"), "utf8")).toBe(SKILL_FILES["SKILL.md"]);
	});

	test("--dir writes a plain copy there and touches nothing else", async () => {
		const project = join(home, "project/.claude/skills");

		const result = await installSkill({ ...at(), dir: project });

		expect(result.installDir).toBe(join(project, "yoqa-testing"));
		expect(result.links).toEqual([]);
		expect((await lstat(result.installDir)).isDirectory()).toBe(true);
		expect(await listFiles(result.installDir)).toEqual(Object.keys(SKILL_FILES).sort());
		expect(await readdir(home)).toEqual(["project"]);
	});
});
