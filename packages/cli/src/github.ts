import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export function isGithubActions(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.GITHUB_ACTIONS === "true";
}

/**
 * Resolve whether to write a GitHub Actions file.
 * Explicit `--flag` / `--no-flag` wins; otherwise auto-enable in GHA when the path is set.
 */
export function resolveGithubWritePath(
	flag: boolean | undefined,
	filePath: string | undefined,
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	if (flag === false) return null;
	const path = filePath?.trim();
	if (!path) return null;
	if (flag === true || isGithubActions(env)) return path;
	return null;
}

export function formatGithubOutputLines(fields: Record<string, string>): string {
	const lines: string[] = [];
	for (const [key, value] of Object.entries(fields)) {
		if (value.includes("\n") || value.includes("\r")) {
			throw new Error(`GitHub output ${key} cannot contain newlines`);
		}
		lines.push(`${key}=${value}`);
	}
	return `${lines.join("\n")}\n`;
}

export async function appendGithubFile(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const body = contents.endsWith("\n") ? contents : `${contents}\n`;
	await appendFile(path, body, "utf8");
}
