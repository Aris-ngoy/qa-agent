import { dirname, join } from "node:path";

export async function pathExists(path: string): Promise<boolean> {
	try {
		return await Bun.file(path).exists();
	} catch {
		return false;
	}
}

export function execRoots(): string[] {
	const roots: string[] = [];
	for (const candidate of [process.execPath, process.argv0]) {
		if (!candidate) continue;
		const dir = dirname(candidate);
		if (!roots.includes(dir)) roots.push(dir);
	}
	return roots;
}

/** Candidate locations for a file under Resources/runner (or beside the host binary). */
export function packagedRunnerFileCandidates(
	fileName: string,
	roots: string[] = execRoots(),
): string[] {
	const paths: string[] = [];
	for (const root of roots) {
		paths.push(
			join(root, fileName),
			join(root, "../Resources/app.asar.unpacked/runner", fileName),
			join(root, "../Resources/runner", fileName),
			join(root, "Resources/app.asar.unpacked/runner", fileName),
			join(root, "Resources/runner", fileName),
		);
	}
	return paths;
}

/** Candidate locations for a file under Resources/skills. */
export function packagedSkillFileCandidates(
	fileName: string,
	roots: string[] = execRoots(),
): string[] {
	const paths: string[] = [];
	for (const root of roots) {
		paths.push(
			join(root, "../Resources/app.asar.unpacked/skills", fileName),
			join(root, "../Resources/skills", fileName),
			join(root, "Resources/app.asar.unpacked/skills", fileName),
			join(root, "Resources/skills", fileName),
		);
	}
	return paths;
}

export async function findFirstExisting(candidates: string[]): Promise<string | null> {
	for (const candidate of candidates) {
		if (await pathExists(candidate)) return candidate;
	}
	return null;
}
