import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { catalogAppSchema } from "@yoqa/runner-client";
import { createCatalogRoutes } from "../../interfaces/http/catalog";
import { CatalogValidationError, createApp, getApp, updateApp } from "./application";
import { closeCatalogDb, openCatalogDb } from "./db";

describe("App Web URL", () => {
	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/catalog-web-url-`)}/catalog.db`);
	});
	afterAll(() => closeCatalogDb());

	test("a web-only App needs only a name and a Web URL", async () => {
		const created = await createApp({ name: "Shop", webUrl: " https://shop.example.com/ " });
		expect(created.webUrl).toBe("https://shop.example.com/");
		expect(created.iosBundleId).toBe("");
		expect(created.androidApplicationId).toBe("");
		expect((await getApp(created.id))?.webUrl).toBe("https://shop.example.com/");
	});

	test("an App starts with an empty Web URL, and update sets, keeps and clears it", async () => {
		const created = await createApp({ name: "Expo app" });
		expect(created.webUrl).toBe("");

		const set = await updateApp(created.id, { webUrl: "http://localhost:8081" });
		expect(set.webUrl).toBe("http://localhost:8081");
		expect((await updateApp(created.id, { name: "Expo" })).webUrl).toBe("http://localhost:8081");
		expect((await updateApp(created.id, { webUrl: "" })).webUrl).toBe("");
	});

	test("a Web URL that is not http or https is refused", async () => {
		const created = await createApp({ name: "Bad URL" });
		await expect(updateApp(created.id, { webUrl: "shop.example.com" })).rejects.toThrow(
			CatalogValidationError,
		);
		await expect(updateApp(created.id, { webUrl: "file:///tmp/index.html" })).rejects.toThrow(
			"Web URL must be an http or https URL",
		);
		await expect(createApp({ name: "Bad", webUrl: "ftp://example.com" })).rejects.toThrow(
			CatalogValidationError,
		);
	});

	test("round-trips through the App create, update and get API", async () => {
		const routes = createCatalogRoutes();
		const send = (method: string, path: string, body?: unknown) =>
			routes.request(path, {
				method,
				headers: { "content-type": "application/json" },
				...(body ? { body: JSON.stringify(body) } : {}),
			});

		const created = await send("POST", "/apps", { name: "Web shop", webUrl: "https://a.example" });
		expect(created.status).toBe(201);
		const { id, webUrl } = catalogAppSchema.parse(await created.json());
		expect(webUrl).toBe("https://a.example");

		const updated = await send("PATCH", `/apps/${id}`, { webUrl: "https://b.example/start" });
		expect(catalogAppSchema.parse(await updated.json()).webUrl).toBe("https://b.example/start");
		const read = await send("GET", `/apps/${id}`);
		expect(catalogAppSchema.parse(await read.json()).webUrl).toBe("https://b.example/start");

		const refused = await send("PATCH", `/apps/${id}`, { webUrl: "not a url" });
		expect(refused.status).toBe(400);
		expect(((await refused.json()) as { error: string }).error).toContain("Web URL");
	});
});

describe("A catalog from before the Web URL", () => {
	afterAll(() => closeCatalogDb());

	test("opens with an empty Web URL on every App", async () => {
		const path = `${await mkdtemp(`${tmpdir()}/catalog-old-`)}/catalog.db`;
		const old = new Database(path);
		old.exec(`
			CREATE TABLE apps (
				id TEXT PRIMARY KEY NOT NULL,
				name TEXT NOT NULL,
				prefix TEXT NOT NULL DEFAULT '',
				context TEXT NOT NULL DEFAULT '',
				knowledge TEXT NOT NULL DEFAULT '',
				ios_bundle_id TEXT NOT NULL DEFAULT '',
				ios_app_store_id TEXT NOT NULL DEFAULT '',
				android_application_id TEXT NOT NULL DEFAULT '',
				appium_caps TEXT NOT NULL DEFAULT '[]',
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			INSERT INTO apps (id, name, prefix, ios_bundle_id, created_at, updated_at)
			VALUES ('app_old', 'Old app', 'old-app', 'com.example.old', 1, 1);
		`);
		old.close();

		closeCatalogDb();
		openCatalogDb(path);
		const app = await getApp("app_old");
		expect(app?.webUrl).toBe("");
		expect(app?.iosBundleId).toBe("com.example.old");
	});
});
