import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const IDB_COMPANION_HOME = join(homedir(), ".yoqa", "idb", "idb_companion");
export const IDB_CLIENT_HOME = join(homedir(), ".yoqa", "idb", "venv", "bin", "idb");

export const MISSING_IDB_MESSAGE =
	"idb_companion not found. Install the official facebook/idb v1.6.5 macOS binary from GitHub releases to ~/.yoqa/idb/idb_companion (or set YOQA_IDB_COMPANION). Do not use `brew trust facebook/fb`.";

export type IdbPathExists = (path: string) => boolean;

/**
 * Official companion binary only — never the Homebrew facebook/fb tap.
 * Env wins, then ~/.yoqa/idb, then PATH.
 */
export function resolveIdbCompanionPath(
	env: NodeJS.ProcessEnv = process.env,
	exists: IdbPathExists = existsSync,
	which: (name: string) => string | null = (name) => Bun.which(name),
): string | undefined {
	const fromEnv = env.YOQA_IDB_COMPANION?.trim();
	if (fromEnv) return fromEnv;
	if (exists(IDB_COMPANION_HOME)) return IDB_COMPANION_HOME;
	return which("idb_companion") ?? undefined;
}

export function resolveIdbClientPath(
	env: NodeJS.ProcessEnv = process.env,
	exists: IdbPathExists = existsSync,
	which: (name: string) => string | null = (name) => Bun.which(name),
): string | undefined {
	const fromEnv = env.YOQA_IDB?.trim();
	if (fromEnv) return fromEnv;
	if (exists(IDB_CLIENT_HOME)) return IDB_CLIENT_HOME;
	return which("idb") ?? undefined;
}

export function requireIdbBins(
	env: NodeJS.ProcessEnv = process.env,
	exists: IdbPathExists = existsSync,
	which: (name: string) => string | null = (name) => Bun.which(name),
): { companion: string; client: string } {
	const companion = resolveIdbCompanionPath(env, exists, which);
	const client = resolveIdbClientPath(env, exists, which);
	if (!companion || !client) {
		throw new Error(MISSING_IDB_MESSAGE);
	}
	return { companion, client };
}
