import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Bun macro: runs when the CLI is bundled (npm `dist/main.js`, the desktop's compiled `yoqa`) or
 * transpiled (`bun run`, `bun test`), and inlines `packages/skill/yoqa-testing` as
 * `{ "SKILL.md": "...", "references/run.md": "..." }`. The CLI then carries the skill it
 * documents, with no file to ship beside it.
 */
export function readSkillFiles(): Record<string, string> {
	const root = join(dirname(fileURLToPath(import.meta.url)), "../../skill/yoqa-testing");
	const files: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isFile())
				files[relative(root, path).split(sep).join("/")] = readFileSync(path, "utf8");
		}
	};
	walk(root);
	return files;
}
