import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp, createCase } from "../catalog/application";
import { closeCatalogDb, getCatalogDb, openCatalogDb } from "../catalog/db";
import { RunNotFoundError, RunValidationError, deleteRunTestVideo, getRun } from "./application";
import { runVideoPath } from "./run-recording";
import { runTests, runs } from "./schema";

describe("deleteRunTestVideo", () => {
	let appId: string;
	let caseId: string;
	let videoDir: string;

	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/catalog-`)}/catalog.db`);
		videoDir = await mkdtemp(`${tmpdir()}/videos-`);
		appId = (await createApp({ name: "Delete app" })).id;
		caseId = (await createCase(appId, { name: "Recorded", recordVideo: true })).id;
	});
	afterAll(() => closeCatalogDb());

	async function seedRun(id: string, status: string) {
		const db = getCatalogDb();
		await db.insert(runs).values({
			id,
			appId,
			deviceId: "device",
			platform: "ios",
			status,
			createdAt: 1,
		});
		await db.insert(runTests).values({
			id: `${id}_test`,
			runId: id,
			caseId,
			status: "passed",
			recordingStatus: "ready",
		});
		const path = runVideoPath(`${id}_test`, videoDir);
		await writeFile(path, "mp4");
		return path;
	}

	test("removes the file and forgets the recording once the Run has finished", async () => {
		const path = await seedRun("run_done", "passed");
		await deleteRunTestVideo("run_done", "run_done_test", videoDir);
		expect(existsSync(path)).toBe(false);
		const run = await getRun("run_done");
		expect(run.tests[0]?.recording).toBeUndefined();
	});

	test("refuses while the Run is still going and keeps the video", async () => {
		const path = await seedRun("run_live", "running");
		await expect(deleteRunTestVideo("run_live", "run_live_test", videoDir)).rejects.toBeInstanceOf(
			RunValidationError,
		);
		expect(existsSync(path)).toBe(true);
	});

	test("reports an unknown test", async () => {
		await expect(deleteRunTestVideo("run_done", "nope", videoDir)).rejects.toBeInstanceOf(
			RunNotFoundError,
		);
	});
});
