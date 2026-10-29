import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { CaseScript, Run } from "@yoqa/runner-client";
import { createApp, createCase, saveCaseScript } from "../catalog/application";
import { closeCatalogDb, openCatalogDb } from "../catalog/db";
import {
	connectDevice,
	disconnectDevice,
	getActiveSession,
	getActiveSessionInfo,
} from "../devices/active-session";
import { type FakeCdp, startFakeCdp } from "../devices/fake-cdp";
import { createRun, getRun } from "./application";

const WEB_URL = "https://shop.example.com/";

/** A Run is over once it is finished and has let go of its Device Session. */
async function finished(runId: string): Promise<Run> {
	for (let attempt = 0; attempt < 500; attempt++) {
		const run = await getRun(runId);
		if (run.status !== "queued" && run.status !== "running" && !getActiveSessionInfo()?.heldByRun) {
			return run;
		}
		await Bun.sleep(10);
	}
	throw new Error(`Run ${runId} did not finish`);
}

/** A case whose saved Case Script taps the middle of the page, on the profile it asks for. */
async function scriptedCase(
	appId: string,
	name: string,
	recordVideo = false,
	profile?: CaseScript["profile"],
): Promise<string> {
	const created = await createCase(appId, { name, recordVideo });
	const script: CaseScript = {
		version: 1,
		savedAt: 1,
		...(profile ? { profile } : {}),
		actions: [{ type: "tap", x: 500, y: 500, reason: "tap the middle" }],
	};
	await saveCaseScript(created.id, JSON.stringify(script), script.savedAt);
	return created.id;
}

describe("a Run on web", () => {
	let browser: FakeCdp;
	let deviceId: string;

	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/web-run-`)}/catalog.db`);
	});
	afterAll(() => closeCatalogDb());

	afterEach(async () => {
		await disconnectDevice();
		browser?.kill();
	});

	function startBrowser() {
		browser = startFakeCdp({ viewport: { width: 1280, height: 800 } });
		deviceId = `chromium-cdp-${browser.port}`;
	}

	test("opens the App's Web URL before the first case, then runs its cases on the page", async () => {
		startBrowser();
		const app = await createApp({ name: "Shop", webUrl: WEB_URL });
		const first = await scriptedCase(app.id, "Tap once");
		const second = await scriptedCase(app.id, "Tap again");

		const created = await createRun({
			appId: app.id,
			caseIds: [first, second],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run.error).toBeNull();
		expect(run.status).toBe("passed");
		expect(run.tests.map((item) => item.status)).toEqual(["passed", "passed"]);
		expect(browser.navigations).toEqual([WEB_URL]);
		expect(browser.clicks).toEqual([
			{ x: 640, y: 400 },
			{ x: 640, y: 400 },
		]);
	});

	test("names its platform, browser, Viewport preset and Lane", async () => {
		startBrowser();
		const app = await createApp({ name: "Named", webUrl: WEB_URL });
		const created = await createRun({
			appId: app.id,
			caseIds: [await scriptedCase(app.id, "Tap")],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run).toMatchObject({
			platform: "web",
			browser: "Chrome 140.0.0.0",
			viewport: "desktop",
			lane: "direct",
		});
	});

	test("on a session connected at the mobile preset, runs at that preset and stores it", async () => {
		startBrowser();
		await connectDevice({ deviceId, platform: "web", viewport: "mobile" });
		const app = await createApp({ name: "Phone web", webUrl: WEB_URL });
		const created = await createRun({
			appId: app.id,
			caseIds: [await scriptedCase(app.id, "Tap")],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run.status).toBe("passed");
		expect(run.viewport).toBe("mobile");
		expect(browser.touches.map((touch) => touch.type)).toEqual(["touchStart", "touchEnd"]);
		expect(browser.clicks).toEqual([{ x: 195, y: 422 }]);
	});

	test("connects on its App's Kept profile by default, and stores it", async () => {
		startBrowser();
		const app = await createApp({ name: "Kept", webUrl: WEB_URL });
		const created = await createRun({
			appId: app.id,
			caseIds: [await scriptedCase(app.id, "Tap")],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run.status).toBe("passed");
		expect(getActiveSession()).toMatchObject({ appId: app.id, profile: "kept" });
		expect(run.profile).toBe("kept");
		expect((await getRun(created.id)).profile).toBe("kept");
	});

	test("connects on a clean profile when a Case Script asks for one", async () => {
		startBrowser();
		const app = await createApp({ name: "Clean case", webUrl: WEB_URL });
		const created = await createRun({
			appId: app.id,
			caseIds: [
				await scriptedCase(app.id, "Signed in"),
				await scriptedCase(app.id, "Signed out", false, "clean"),
			],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run.status).toBe("passed");
		expect(getActiveSession()).toMatchObject({ appId: app.id, profile: "clean" });
		expect(run.profile).toBe("clean");
	});

	test("the Run's profile wins over its cases'", async () => {
		startBrowser();
		const app = await createApp({ name: "Run decides", webUrl: WEB_URL });
		const keptRun = await finished(
			(
				await createRun({
					appId: app.id,
					caseIds: [await scriptedCase(app.id, "Asks clean", false, "clean")],
					deviceId,
					platform: "web",
					executionMode: "script",
					profile: "kept",
				})
			).id,
		);
		expect(keptRun.profile).toBe("kept");
		expect(getActiveSession()?.profile).toBe("kept");

		const cleanRun = await finished(
			(
				await createRun({
					appId: app.id,
					caseIds: [await scriptedCase(app.id, "Asks nothing")],
					deviceId,
					platform: "web",
					executionMode: "script",
					profile: "clean",
				})
			).id,
		);
		expect(cleanRun.status).toBe("passed");
		expect(cleanRun.profile).toBe("clean");
		expect(getActiveSession()?.profile).toBe("clean");
	});

	test("marks a requested recording as no video, with the reason, and still passes", async () => {
		startBrowser();
		const app = await createApp({ name: "Recorded", webUrl: WEB_URL });
		const created = await createRun({
			appId: app.id,
			caseIds: [await scriptedCase(app.id, "Recorded tap", true)],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run.status).toBe("passed");
		expect(run.tests[0]?.recording).toEqual({
			status: "unavailable",
			note: "Run recording is not available on web",
		});
	});

	test("fails fast, naming the fix, when the App has no Web URL", async () => {
		startBrowser();
		const app = await createApp({ name: "Mobile only" });
		const created = await createRun({
			appId: app.id,
			caseIds: [await scriptedCase(app.id, "Never runs")],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run.status).toBe("errored");
		expect(run.error).toBe(
			`Mobile only has no Web URL, so a Run on web has nothing to open. Set one with: yoqa apps update ${app.prefix} --web-url <url>`,
		);
		expect(run.tests[0]?.status).toBe("errored");
		expect(getActiveSessionInfo()).toBeNull();
		expect(browser.navigations).toEqual([]);
		expect(browser.clicks).toEqual([]);
	});
});
