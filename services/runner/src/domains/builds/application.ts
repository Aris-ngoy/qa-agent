import { basename, extname } from "node:path";
import type { Build, CreateBuildRequest } from "@yoqa/runner-client";
import { desc, eq } from "drizzle-orm";
import { getCatalogDb } from "../catalog/db";
import { resolveAndroidAppiumIdentity } from "../devices/application";
import { builds } from "./schema";

export class BuildNotFoundError extends Error {
	constructor(message = "Build not found") {
		super(message);
		this.name = "BuildNotFoundError";
	}
}

export class BuildValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "BuildValidationError";
	}
}

function newId(): string {
	return `build_${crypto.randomUUID()}`;
}

function detectPlatform(path: string): Build["platform"] {
	const ext = extname(path).toLowerCase();
	if (ext === ".apk" || ext === ".aab") return "android";
	if (ext === ".ipa" || ext === ".app") return "ios";
	if (path.endsWith(".app") || path.includes(".app/")) return "ios";
	return "unknown";
}

function mapBuild(row: typeof builds.$inferSelect): Build {
	return {
		id: row.id,
		appId: row.appId,
		path: row.path,
		platform: row.platform as Build["platform"],
		name: row.name,
		bundleId: row.bundleId,
		version: row.version,
		createdAt: row.createdAt,
	};
}

export async function listBuilds(appId?: string): Promise<Build[]> {
	const db = getCatalogDb();
	const rows = appId
		? await db.select().from(builds).where(eq(builds.appId, appId)).orderBy(desc(builds.createdAt))
		: await db.select().from(builds).orderBy(desc(builds.createdAt));
	return rows.map(mapBuild);
}

export async function getBuild(buildId: string): Promise<Build | null> {
	const db = getCatalogDb();
	const row = await db.query.builds.findFirst({ where: eq(builds.id, buildId) });
	return row ? mapBuild(row) : null;
}

export async function createBuild(input: CreateBuildRequest): Promise<Build> {
	const path = input.path.trim();
	if (!path) {
		throw new BuildValidationError("Build path is required");
	}
	const exists = await Bun.file(path)
		.exists()
		.catch(() => false);
	// .app is a directory — Bun.file may fail; check via spawn
	let pathOk = exists;
	if (!pathOk) {
		const { exitCode } = await (async () => {
			const proc = Bun.spawn(["test", "-e", path], { stdout: "ignore", stderr: "ignore" });
			return { exitCode: await proc.exited };
		})();
		pathOk = exitCode === 0;
	}
	if (!pathOk) {
		throw new BuildValidationError(`Build path does not exist: ${path}`);
	}

	const platform = detectPlatform(path);
	const name = input.name?.trim() || basename(path);
	const db = getCatalogDb();
	const id = newId();
	const now = Date.now();
	await db.insert(builds).values({
		id,
		appId: input.appId ?? null,
		path,
		platform,
		name,
		bundleId: null,
		version: null,
		createdAt: now,
	});
	const created = await getBuild(id);
	if (!created) throw new Error("Failed to create build");
	return created;
}

export async function deleteBuild(buildId: string): Promise<void> {
	const db = getCatalogDb();
	const existing = await getBuild(buildId);
	if (!existing) throw new BuildNotFoundError();
	await db.delete(builds).where(eq(builds.id, buildId));
}

/** Resolve a build id or create one from an absolute path for run install. */
export async function resolveBuildForRun(options: {
	buildId?: string;
	buildPath?: string;
	appId?: string;
}): Promise<Build | null> {
	if (options.buildId) {
		const build = await getBuild(options.buildId);
		if (!build) throw new BuildNotFoundError(`Build not found: ${options.buildId}`);
		return build;
	}
	if (options.buildPath) {
		return createBuild({ path: options.buildPath, appId: options.appId });
	}
	return null;
}

export async function installBuildOnDevice(options: {
	build: Build;
	deviceId: string;
	platform: "ios" | "android";
}): Promise<void> {
	const { build, deviceId, platform } = options;
	if (platform === "ios") {
		if (build.path.endsWith(".app") || build.path.includes(".app")) {
			const proc = Bun.spawn(["xcrun", "simctl", "install", deviceId, build.path], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
			if (code !== 0) {
				throw new Error(`simctl install failed: ${stderr.trim() || `exit ${code}`}`);
			}
			return;
		}
		// .ipa on physical — try ideviceinstaller or tip
		const which = Bun.which("ideviceinstaller");
		if (which && build.path.endsWith(".ipa")) {
			const proc = Bun.spawn([which, "-u", deviceId, "-i", build.path], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
			if (code !== 0) {
				throw new Error(`ideviceinstaller failed: ${stderr.trim() || `exit ${code}`}`);
			}
			return;
		}
		throw new Error(
			`Cannot install iOS build at ${build.path}. Use a .app on simulator or install .ipa via ideviceinstaller.`,
		);
	}

	const identity = await resolveAndroidAppiumIdentity(deviceId);
	const serial = identity.udid;
	if (!serial) {
		throw new Error(
			`Android emulator ${deviceId} is not running. Boot it, then retry the install.`,
		);
	}

	const adb = Bun.which("adb") ?? "adb";
	const proc = Bun.spawn([adb, "-s", serial, "install", "-r", build.path], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
	if (code !== 0) {
		throw new Error(`adb install failed: ${stderr.trim() || `exit ${code}`}`);
	}
}
