import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Run, RunStatus } from "@yoqa/runner-client";
import { createApp } from "../../domains/catalog/application";
import { closeCatalogDb, getCatalogDb, openCatalogDb } from "../../domains/catalog/db";
import { runs } from "../../domains/runs/schema";
import { createRunsRoutes, parseByteRange, serveVideo } from "./runs";

describe("parseByteRange", () => {
	test("reads closed, open-ended and suffix ranges", () => {
		expect(parseByteRange("bytes=0-99", 1000)).toEqual({ start: 0, end: 99 });
		expect(parseByteRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
		expect(parseByteRange("bytes=0-5000", 1000)).toEqual({ start: 0, end: 999 });
	});

	test("ignores missing or malformed ranges and flags unsatisfiable ones", () => {
		expect(parseByteRange(undefined, 1000)).toBeNull();
		expect(parseByteRange("bytes=-", 1000)).toBeNull();
		expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=2000-", 1000)).toBe("unsatisfiable");
		expect(parseByteRange("bytes=0-9", 0)).toBe("unsatisfiable");
	});
});

describe("serveVideo", () => {
	async function videoFile() {
		const path = `${await mkdtemp(`${tmpdir()}/serve-`)}/v.mp4`;
		await writeFile(
			path,
			Uint8Array.from({ length: 256 }, (_, i) => i),
		);
		return path;
	}

	test("sends the whole file with its length, so the player knows the size", async () => {
		const response = await serveVideo(await videoFile(), undefined);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-length")).toBe("256");
		expect(response.headers.get("accept-ranges")).toBe("bytes");
		expect((await response.arrayBuffer()).byteLength).toBe(256);
	});

	test("answers a Range request with exactly that part and its length", async () => {
		const response = await serveVideo(await videoFile(), "bytes=10-19");
		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 10-19/256");
		expect(response.headers.get("content-length")).toBe("10");
		expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
			10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
		]);
	});

	test("rejects a Range past the end with 416", async () => {
		const response = await serveVideo(await videoFile(), "bytes=300-");
		expect(response.status).toBe(416);
		expect(response.headers.get("content-range")).toBe("bytes */256");
	});
});

describe("GET /runs", () => {
	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/runs-route-`)}/catalog.db`);
	});
	afterAll(() => closeCatalogDb());

	let created = 0;
	async function seedRun(appId: string, status: RunStatus): Promise<string> {
		const id = `run_${status}_${++created}`;
		await getCatalogDb()
			.insert(runs)
			.values({
				id,
				appId,
				deviceId: "emulator-5554",
				platform: "android",
				status,
				executionMode: "auto",
				createdAt: created,
				startedAt: created,
				finishedAt: status === "running" ? null : created + 1,
			});
		return id;
	}

	async function list(query: string) {
		const response = await createRunsRoutes().request(`/runs${query}`);
		return { status: response.status, body: (await response.json()) as { runs: Run[] } };
	}

	test("status=running without an appId lists the Runs in progress across every App", async () => {
		const shop = await createApp({ name: "Shop" });
		const bank = await createApp({ name: "Bank" });
		const shopRunning = await seedRun(shop.id, "running");
		await seedRun(shop.id, "passed");
		const bankRunning = await seedRun(bank.id, "running");
		await seedRun(bank.id, "cancelled");

		const listed = await list("?status=running");
		expect(listed.status).toBe(200);
		expect(listed.body.runs.map((run) => run.id).sort()).toEqual([bankRunning, shopRunning].sort());
		expect(listed.body.runs.every((run) => run.status === "running")).toBe(true);
	});

	test("with an appId it lists every Run of that App, as before", async () => {
		const app = await createApp({ name: "Notes" });
		const running = await seedRun(app.id, "running");
		const passed = await seedRun(app.id, "passed");
		await seedRun((await createApp({ name: "Other" })).id, "running");

		const listed = await list(`?appId=${app.id}`);
		expect(listed.status).toBe(200);
		expect(listed.body.runs.map((run) => run.id)).toEqual([passed, running]);
	});

	test("with an appId and status=running it lists only that App's Runs in progress", async () => {
		const app = await createApp({ name: "Maps" });
		const running = await seedRun(app.id, "running");
		await seedRun(app.id, "errored");
		await seedRun((await createApp({ name: "Weather" })).id, "running");

		const listed = await list(`?appId=${app.id}&status=running`);
		expect(listed.status).toBe(200);
		expect(listed.body.runs.map((run) => run.id)).toEqual([running]);
	});

	test("asks for an appId when it has neither an appId nor status=running", async () => {
		expect((await list("")).status).toBe(400);
		expect((await list("?status=passed")).status).toBe(400);
	});
});
