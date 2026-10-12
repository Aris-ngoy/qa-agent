import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { createApp, createCase, getApp, getCase, updateApp, updateCase } from "./application";
import { closeCatalogDb, getCatalogDb, openCatalogDb } from "./db";
import { apps, cases } from "./schema";

describe("App and Case Appium capabilities", () => {
	let appId: string;

	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/catalog-caps-`)}/catalog.db`);
		appId = (await createApp({ name: "Caps app" })).id;
	});
	afterAll(() => closeCatalogDb());

	test("a saved App capability is not shown and a write does not bring it back", async () => {
		const db = getCatalogDb();
		await db
			.update(apps)
			.set({
				appiumCaps: JSON.stringify([{ id: "cap-1", key: "appium:autoLaunch", value: "false" }]),
			})
			.where(eq(apps.id, appId));

		expect((await getApp(appId))?.capabilities).toEqual([]);

		const updated = await updateApp(appId, {
			capabilities: [{ id: "cap-2", key: "appium:appActivity", value: ".Main" }],
		});
		expect(updated.capabilities).toEqual([]);
		expect((await getApp(appId))?.capabilities).toEqual([]);
	});

	test("a saved Case capability is not shown and a write does not bring it back", async () => {
		const created = await createCase(appId, {
			name: "Launch",
			capabilities: [{ id: "cap-3", key: "appium:autoLaunch", value: "false" }],
		});
		expect(created.capabilities).toEqual([]);

		const db = getCatalogDb();
		await db
			.update(cases)
			.set({
				appiumCaps: JSON.stringify([{ id: "cap-4", key: "appium:appActivity", value: ".Debug" }]),
			})
			.where(eq(cases.id, created.id));

		expect((await getCase(created.id))?.capabilities).toEqual([]);

		const updated = await updateCase(created.id, {
			capabilities: [{ id: "cap-5", key: "appium:appWaitActivity", value: "*" }],
		});
		expect(updated.capabilities).toEqual([]);
		expect((await getCase(created.id))?.capabilities).toEqual([]);
	});
});
