import { describe, expect, test } from "bun:test";
import { findCatalogApp } from "./catalog-app";

const apps = [
	{ id: "app_1", prefix: "demo", name: "Yoqa Demo" },
	{ id: "app_2", prefix: "shop", name: "Shop" },
];

describe("findCatalogApp", () => {
	test("matches prefix case-insensitively", () => {
		expect(findCatalogApp(apps, "DEMO")?.id).toBe("app_1");
		expect(findCatalogApp(apps, "demo")?.id).toBe("app_1");
	});

	test("matches exact id", () => {
		expect(findCatalogApp(apps, "app_2")?.prefix).toBe("shop");
	});

	test("returns undefined when missing", () => {
		expect(findCatalogApp(apps, "missing")).toBeUndefined();
		expect(findCatalogApp(apps, "  ")).toBeUndefined();
	});
});
