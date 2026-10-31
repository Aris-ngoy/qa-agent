import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaseScript, Run } from "@yoqa/runner-client";
import {
	acceptEverydayWarning,
	createApp,
	createCase,
	saveCaseScript,
} from "../catalog/application";
import { closeCatalogDb, openCatalogDb } from "../catalog/db";
import * as actualEveryday from "../devices/chromium-everyday";
import { EVERYDAY_WARNING } from "../devices/everyday-warning";
import { type FakeCdp, startFakeCdp } from "../devices/fake-cdp";

/**
 * The Everyday browsers found here: a faked one while a test sets it, else the real search.
 * Bun keeps a module mock for the rest of the process, so it must fall back.
 */
let everydayBrowsers: actualEveryday.EverydayBrowser[] | null = null;
const realFindEverydayBrowsers = actualEveryday.findEverydayBrowsers;
mock.module("../devices/chromium-everyday", () => ({
	...actualEveryday,
	findEverydayBrowsers: (...args: Parameters<typeof realFindEverydayBrowsers>) =>
		everydayBrowsers ? Promise.resolve(everydayBrowsers) : realFindEverydayBrowsers(...args),
}));

const {
	connectDevice,
	disconnectDevice,
	getActiveSession,
	getActiveSessionInfo,
	quitEverySession,
} = await import("../devices/active-session");
const { RunValidationError, cancelRunsInProgress, createRun, getRun } = await import(
	"./application"
);

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

	test("a Run in progress when the runner stops is cancelled, not left running", async () => {
		startBrowser();
		const app = await createApp({ name: "Stopped", webUrl: WEB_URL });
		const created = await createCase(app.id, { name: "Waits" });
		const script: CaseScript = { version: 1, savedAt: 1, actions: [{ type: "wait", ms: 1_000 }] };
		await saveCaseScript(created.id, JSON.stringify(script), script.savedAt);
		const run = await createRun({
			appId: app.id,
			caseIds: [created.id],
			deviceId,
			platform: "web",
			executionMode: "script",
		});
		for (let attempt = 0; attempt < 200 && !getActiveSessionInfo()?.heldByRun; attempt++) {
			await Bun.sleep(10);
		}

		await cancelRunsInProgress();
		await quitEverySession();

		const stopped = await getRun(run.id);
		expect(stopped.status).toBe("cancelled");
		expect(stopped.tests[0]).toMatchObject({ status: "cancelled", error: "The runner stopped" });
		expect(getActiveSession()).toBeNull();
		expect((await finished(run.id)).status).toBe("cancelled");
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

describe("a Run on the Everyday browser", () => {
	let browser: FakeCdp;

	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/web-run-everyday-`)}/catalog.db`);
	});
	afterAll(() => {
		closeCatalogDb();
		everydayBrowsers = null;
	});

	afterEach(async () => {
		await disconnectDevice();
		browser?.kill();
	});

	/** The user's Chrome with the remote-debugging toggle on, its profile named Work. */
	function startEverydayChrome() {
		browser = startFakeCdp({ viewport: { width: 1280, height: 800 }, consent: true });
		const userDataDir = mkdtempSync(join(tmpdir(), "yoqa-chrome-"));
		writeFileSync(
			join(userDataDir, "DevToolsActivePort"),
			`${browser.port}\n/devtools/browser/fake\n`,
		);
		writeFileSync(
			join(userDataDir, "Local State"),
			JSON.stringify({ profile: { info_cache: { Default: { name: "Work" } } } }),
		);
		everydayBrowsers = [{ id: "web-chrome-everyday", name: "Google Chrome", userDataDir }];
	}

	/** An App whose user accepted the Everyday browser warning. */
	async function acceptedApp(name: string) {
		const app = await createApp({ name, webUrl: WEB_URL });
		await acceptEverydayWarning(app.id);
		return app;
	}

	test("names the Everyday browser and the profile its window opened in, and clears nothing", async () => {
		startEverydayChrome();
		const app = await acceptedApp("Everyday");
		browser.allow();
		const created = await createRun({
			appId: app.id,
			caseIds: [await scriptedCase(app.id, "Tap")],
			deviceId: "web-chrome-everyday",
			platform: "web",
			executionMode: "script",
		});
		const run = await finished(created.id);

		expect(run.error).toBeNull();
		expect(run.status).toBe("passed");
		expect(run).toMatchObject({
			browser: "Everyday Google Chrome 140.0.0.0",
			browserProfileName: "Work",
		});
		// Not a Kept profile, nor a clean one: the user's own.
		expect(run.profile).toBeUndefined();
		expect(
			browser.methods.filter((method) => /^(Storage|Network)\.(clear|delete)/.test(method)),
		).toEqual([]);
		expect(browser.navigations).toEqual([WEB_URL]);
	});

	test("adopts the Everyday browser the user connected, whichever App it was connected for", async () => {
		startEverydayChrome();
		const app = await acceptedApp("Adopted");
		browser.allow();
		await connectDevice({ deviceId: "web-chrome-everyday", platform: "web" });
		const run = await finished(
			(
				await createRun({
					appId: app.id,
					caseIds: [await scriptedCase(app.id, "Tap")],
					deviceId: "web-chrome-everyday",
					platform: "web",
					executionMode: "script",
				})
			).id,
		);

		expect(run.status).toBe("passed");
		// One Allow: the Run did not ask the user again.
		expect(browser.socketRequests()).toBe(1);
	});

	test("profile: clean fails before the Run starts, naming the Kept profile as the way to a clean one", async () => {
		startEverydayChrome();
		const app = await acceptedApp("Clean asked");
		const asked = await rejection(
			createRun({
				appId: app.id,
				caseIds: [await scriptedCase(app.id, "Tap")],
				deviceId: "web-chrome-everyday",
				platform: "web",
				executionMode: "script",
				profile: "clean",
			}),
		);
		expect(asked).toBeInstanceOf(RunValidationError);
		expect((asked as Error).message).toContain("Kept profile");

		const byCase = await rejection(
			createRun({
				appId: app.id,
				caseIds: [await scriptedCase(app.id, "Signed out", false, "clean")],
				deviceId: "web-chrome-everyday",
				platform: "web",
				executionMode: "script",
			}),
		);
		expect((byCase as Error).message).toBe((asked as Error).message);
		expect(browser.socketRequests()).toBe(0);
	});

	test("fails before it starts for an App that has not accepted the warning", async () => {
		startEverydayChrome();
		const app = await createApp({ name: "Not warned", webUrl: WEB_URL });
		const error = await rejection(
			createRun({
				appId: app.id,
				caseIds: [await scriptedCase(app.id, "Tap")],
				deviceId: "web-chrome-everyday",
				platform: "web",
				executionMode: "script",
			}),
		);
		expect(error).toBeInstanceOf(RunValidationError);
		expect((error as Error).message).toContain(EVERYDAY_WARNING);
		expect(browser.socketRequests()).toBe(0);
	});
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	return promise.then(
		() => null,
		(error: unknown) => error,
	);
}
