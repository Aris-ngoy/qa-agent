import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createApp, createCase, getCase, updateCase } from "./application";
import { closeCatalogDb, openCatalogDb } from "./db";

describe("Test Case video recording flag", () => {
	let appId: string;

	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/catalog-`)}/catalog.db`);
		appId = (await createApp({ name: "Recording app" })).id;
	});
	afterAll(() => closeCatalogDb());

	test("a new case does not record video by default", async () => {
		const created = await createCase(appId, { name: "Plain" });
		expect(created.recordVideo).toBe(false);
	});

	test("the flag is saved on create and read back", async () => {
		const created = await createCase(appId, { name: "Recorded", recordVideo: true });
		expect(created.recordVideo).toBe(true);
		expect((await getCase(created.id))?.recordVideo).toBe(true);
	});

	test("update toggles the flag and leaves it alone when omitted", async () => {
		const created = await createCase(appId, { name: "Toggled" });
		expect((await updateCase(created.id, { recordVideo: true })).recordVideo).toBe(true);
		expect((await updateCase(created.id, { name: "Renamed" })).recordVideo).toBe(true);
		expect((await updateCase(created.id, { recordVideo: false })).recordVideo).toBe(false);
	});
});
