import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { CaseScript, Run } from "@yoqa/runner-client";
import { createApp, createCase, getCase, saveCaseScript } from "../catalog/application";
import { closeCatalogDb, openCatalogDb } from "../catalog/db";
import { disconnectDevice, getActiveSessionInfo } from "../devices/active-session";
import { type FakeCdp, startFakeCdp } from "../devices/fake-cdp";
import { cancelRun, createDraftRun, createRun, getRun } from "./application";
import { type FakeVision, addFakeVisionProvider, startFakeVision } from "./fake-vision";

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

const SAVED_SCRIPT: CaseScript = {
	version: 1,
	savedAt: 1,
	actions: [{ type: "tap", x: 100, y: 100, reason: "the saved tap" }],
};

/** A saved case with one step and a Case Script (on `profile`, if given), never run, on a web App. */
async function savedCase(
	name: string,
	profile?: CaseScript["profile"],
): Promise<{ appId: string; caseId: string }> {
	const app = await createApp({ name, webUrl: WEB_URL });
	const created = await createCase(app.id, {
		name,
		flows: [{ instructions: "Open the saved page", expectedResult: "The saved page shows" }],
	});
	const script = profile ? { ...SAVED_SCRIPT, profile } : SAVED_SCRIPT;
	await saveCaseScript(created.id, JSON.stringify(script), script.savedAt);
	return { appId: app.id, caseId: created.id };
}

describe("a Run of a Case draft's steps", () => {
	let browser: FakeCdp;
	let vision: FakeVision;
	let deviceId: string;

	beforeAll(async () => {
		closeCatalogDb();
		openCatalogDb(`${await mkdtemp(`${tmpdir()}/draft-run-`)}/catalog.db`);
		vision = startFakeVision();
		await addFakeVisionProvider(vision);
	});
	afterAll(() => {
		vision.stop();
		closeCatalogDb();
	});

	afterEach(async () => {
		await disconnectDevice();
		browser?.kill();
		vision.prompts = [];
		vision.failWith = null;
		vision.held = null;
		vision.deciding = false;
	});

	function startBrowser() {
		browser = startFakeCdp({ viewport: { width: 1280, height: 800 } });
		deviceId = `chromium-cdp-${browser.port}`;
	}

	test("runs the draft's steps with the agent and hands back what it learned, leaving the saved case alone", async () => {
		startBrowser();
		const { appId, caseId } = await savedCase("Draft by agent");
		const before = await getCase(caseId);

		const { run: created, outcome } = await createDraftRun({
			appId,
			caseId,
			deviceId,
			platform: "web",
			executionMode: "agent",
			steps: {
				flows: [
					{
						id: "draft-1",
						instructions: "Tap the draft button",
						expectedResult: "The draft page shows",
					},
				],
				script: null,
			},
		});
		const result = await outcome;
		const run = await finished(created.id);

		expect(run.status).toBe("passed");
		expect(vision.prompts.join("\n")).toContain("Tap the draft button");
		expect(vision.prompts.join("\n")).not.toContain("Open the saved page");
		expect(result).toMatchObject({ runId: created.id, status: "passed", error: null });
		expect(result.learnedScript?.actions).toEqual([
			expect.objectContaining({ type: "tap", x: 500, y: 500 }),
		]);

		const after = await getCase(caseId);
		expect(after?.script).toEqual(before?.script ?? null);
		expect(after?.scriptSavedAt).toBe(before?.scriptSavedAt ?? null);
		expect(after?.lastRunStatus).toBe(before?.lastRunStatus ?? null);
		expect(after?.lastRunAt).toBe(before?.lastRunAt ?? null);
	});

	test("replays the draft's Case Script when it has one, with no Decide and nothing saved", async () => {
		startBrowser();
		const { appId, caseId } = await savedCase("Draft by replay");
		const before = await getCase(caseId);
		const draftScript: CaseScript = {
			version: 1,
			savedAt: 2,
			actions: [{ type: "tap", x: 250, y: 250, reason: "the draft's tap" }],
		};

		const { run: created, outcome } = await createDraftRun({
			appId,
			caseId,
			deviceId,
			platform: "web",
			steps: {
				flows: [{ id: "draft-1", instructions: "Tap the corner", expectedResult: "It opens" }],
				script: draftScript,
			},
		});
		const result = await outcome;
		const run = await finished(created.id);

		expect(run.status).toBe("passed");
		expect(run.tests[0]?.executionMode).toBe("script");
		expect(browser.clicks).toEqual([{ x: 320, y: 200 }]);
		expect(vision.prompts).toEqual([]);
		expect(result).toMatchObject({ status: "passed", error: null, learnedScript: null });
		const after = await getCase(caseId);
		expect(after?.script).toEqual(before?.script ?? null);
		expect(after?.lastRunStatus).toBe(before?.lastRunStatus ?? null);
	});

	test("the agent runs a draft on the profile the saved Case Script asks for, and learns onto it", async () => {
		startBrowser();
		const { appId, caseId } = await savedCase("Draft on a clean profile", "clean");

		const { run: created, outcome } = await createDraftRun({
			appId,
			caseId,
			deviceId,
			platform: "web",
			steps: {
				flows: [{ id: "draft-1", instructions: "Tap the draft button", expectedResult: "Done" }],
				script: null,
			},
		});
		const result = await outcome;
		const run = await finished(created.id);

		expect(run.tests[0]?.executionMode).toBe("agent");
		expect(run.profile).toBe("clean");
		expect(result.status).toBe("passed");
		expect(result.learnedScript?.profile).toBe("clean");
	});

	test("a draft Run cancelled mid-case hands back cancelled and leaves the saved case alone", async () => {
		startBrowser();
		const { appId, caseId } = await savedCase("Draft cancelled");
		const { promise: held, resolve: release } = Promise.withResolvers<void>();
		vision.held = held;

		const { run: created, outcome } = await createDraftRun({
			appId,
			caseId,
			deviceId,
			platform: "web",
			executionMode: "agent",
			steps: {
				flows: [{ id: "draft-1", instructions: "Tap the draft button", expectedResult: "Done" }],
				script: null,
			},
		});
		for (let attempt = 0; attempt < 500 && !vision.deciding; attempt++) await Bun.sleep(10);
		await cancelRun(created.id);
		release();
		const result = await outcome;
		const run = await finished(created.id);

		expect(run.status).toBe("cancelled");
		expect(result).toMatchObject({ status: "cancelled", learnedScript: null });
		const after = await getCase(caseId);
		expect(after?.script).toEqual(SAVED_SCRIPT);
		expect(after?.lastRunStatus).toBeNull();
	});

	test("a draft Run that fails hands back why and leaves the last result alone", async () => {
		startBrowser();
		const { appId, caseId } = await savedCase("Draft that fails");
		vision.failWith = "There is no draft button";

		const { run: created, outcome } = await createDraftRun({
			appId,
			caseId,
			deviceId,
			platform: "web",
			executionMode: "agent",
			steps: {
				flows: [{ id: "draft-1", instructions: "Tap the draft button", expectedResult: "Done" }],
				script: null,
			},
		});
		const result = await outcome;
		await finished(created.id);

		expect(result.status).toBe("errored");
		expect(result.error).toContain("There is no draft button");
		expect(result.learnedScript).toBeNull();
		const after = await getCase(caseId);
		expect(after?.lastRunStatus).toBeNull();
		expect(after?.lastRunAt).toBeNull();
		expect(after?.script).toEqual(SAVED_SCRIPT);
	});

	test("a draft Run that cannot start hands back why and leaves the last result alone", async () => {
		const app = await createApp({ name: "No Web URL" });
		const created = await createCase(app.id, { name: "Draft with nothing to open" });

		const { outcome } = await createDraftRun({
			appId: app.id,
			caseId: created.id,
			deviceId: "chromium-cdp-1",
			platform: "web",
			steps: {
				flows: [{ id: "draft-1", instructions: "Tap", expectedResult: "Done" }],
				script: SAVED_SCRIPT,
			},
		});
		const result = await outcome;

		expect(result.status).toBe("errored");
		expect(result.error).toContain("has no Web URL");
		const after = await getCase(created.id);
		expect(after?.lastRunStatus).toBeNull();
		expect(after?.lastRunAt).toBeNull();
	});

	test("a draft with no steps is refused", async () => {
		const { appId, caseId } = await savedCase("Empty draft");
		await expect(
			createDraftRun({
				appId,
				caseId,
				deviceId: "chromium-cdp-1",
				platform: "web",
				steps: { flows: [], script: null },
			}),
		).rejects.toThrow("at least one step");
	});

	test("a normal agent Run of the saved case still saves its learned Case Script and last result", async () => {
		startBrowser();
		const { appId, caseId } = await savedCase("Saved by agent");

		const created = await createRun({
			appId,
			caseIds: [caseId],
			deviceId,
			platform: "web",
			executionMode: "agent",
		});
		const run = await finished(created.id);

		expect(run.status).toBe("passed");
		expect(vision.prompts.join("\n")).toContain("Open the saved page");
		const after = await getCase(caseId);
		expect(after?.lastRunStatus).toBe("passed");
		expect(after?.script?.actions).toEqual([
			expect.objectContaining({ type: "tap", x: 500, y: 500 }),
		]);
		expect(after?.scriptSavedAt).not.toBe(SAVED_SCRIPT.savedAt);
	});
});
