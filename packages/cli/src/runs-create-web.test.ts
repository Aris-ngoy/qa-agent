import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CatalogApp, CatalogCase, CreateRunRequest, Run } from "@yoqa/runner-client";
import { buildProgram } from "./program";

const APP: CatalogApp = {
	id: "app_1",
	name: "Shop",
	prefix: "shop",
	context: "",
	knowledge: "",
	iosBundleId: "",
	iosAppStoreId: "",
	androidApplicationId: "",
	webUrl: "https://shop.example.com",
	capabilities: [],
	createdAt: 1,
	updatedAt: 1,
};

const CASE: CatalogCase = {
	id: "case_1",
	appId: APP.id,
	number: 1,
	name: "Checkout",
	tags: [],
	flows: [],
	capabilities: [],
	recordVideo: false,
	hasScript: false,
	scriptSavedAt: null,
	script: null,
	lastRunAt: null,
	lastRunStatus: null,
	createdAt: 1,
	updatedAt: 1,
};

/** A runner with one App and one case, and no Active Session until one is set, that records each Run asked for. */
function fakeRunner() {
	const runs: CreateRunRequest[] = [];
	let activeDevice: { deviceId: string; platform: "web" } | null = null;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const { pathname } = new URL(request.url);
			if (pathname === "/apps") return Response.json({ apps: [APP] });
			if (pathname === `/apps/${APP.id}/cases`) return Response.json({ cases: [CASE] });
			if (pathname === "/devices/active") {
				if (!activeDevice) return Response.json({ error: "none" }, { status: 404 });
				return Response.json({
					...activeDevice,
					connectedAt: 1,
					streamReady: false,
					streamState: "none",
					streamUrl: "/stream.mjpeg",
					heldByRun: false,
					lane: "direct",
				});
			}
			if (request.method === "POST" && pathname === "/runs") {
				const body = (await request.json()) as CreateRunRequest;
				runs.push(body);
				const run: Run = {
					id: "run_1",
					appId: body.appId,
					deviceId: body.deviceId,
					platform: body.platform,
					buildId: null,
					status: "queued",
					executionMode: "auto",
					error: null,
					createdAt: 1,
					startedAt: null,
					finishedAt: null,
					tests: [],
				};
				return Response.json(run, { status: 201 });
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return {
		runs,
		url: `http://127.0.0.1:${server.port}`,
		stop: () => server.stop(true),
		connect: (deviceId: string | null) => {
			activeDevice = deviceId ? { deviceId, platform: "web" } : null;
		},
	};
}

async function yoqa(...args: string[]): Promise<void> {
	await buildProgram().parseAsync(["bun", "yoqa", ...args]);
}

describe("yoqa runs create on a web device", () => {
	const runner = fakeRunner();
	const autostart = process.env.YOQA_NO_AUTOSTART;
	// Restored as 0 when unset: Bun keeps a failure code if `exitCode` is set back to undefined.
	const exitCode = process.exitCode ?? 0;
	const log = console.log;

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		console.log = () => undefined;
	});

	afterAll(() => {
		runner.stop();
		console.log = log;
		process.exitCode = exitCode;
		if (autostart === undefined) Reflect.deleteProperty(process.env, "YOQA_NO_AUTOSTART");
		else process.env.YOQA_NO_AUTOSTART = autostart;
	});

	test("runs on web for an installed browser's id, with no --platform and no session", async () => {
		await yoqa(
			"runs",
			"create",
			"shop",
			"--cases",
			"1",
			"--device",
			"web-chrome",
			"--no-github-output",
			"--base-url",
			runner.url,
		);
		expect(runner.runs.at(-1)).toMatchObject({ deviceId: "web-chrome", platform: "web" });
	});

	test("runs on web for an attached Chromium's port", async () => {
		await yoqa(
			"runs",
			"create",
			"shop",
			"--cases",
			"1",
			"--device",
			"chromium-cdp-9222",
			"--no-github-output",
			"--base-url",
			runner.url,
		);
		expect(runner.runs.at(-1)).toMatchObject({ deviceId: "chromium-cdp-9222", platform: "web" });
	});

	test("asks for a clean profile with --profile clean", async () => {
		await yoqa(
			"runs",
			"create",
			"shop",
			"--cases",
			"1",
			"--device",
			"web-chrome",
			"--profile",
			"clean",
			"--no-github-output",
			"--base-url",
			runner.url,
		);
		expect(runner.runs.at(-1)).toMatchObject({ deviceId: "web-chrome", profile: "clean" });
	});

	test("runs on the Everyday browser when --device names it", async () => {
		await yoqa(
			"runs",
			"create",
			"shop",
			"--cases",
			"1",
			"--device",
			"web-chrome-everyday",
			"--no-github-output",
			"--base-url",
			runner.url,
		);
		expect(runner.runs.at(-1)).toMatchObject({
			deviceId: "web-chrome-everyday",
			platform: "web",
		});
	});

	test("with no --device, never runs on the Everyday browser the session is connected to", async () => {
		const error = console.error;
		const errors: string[] = [];
		console.error = (message: string) => errors.push(message);
		runner.connect("web-chrome-everyday");
		const before = runner.runs.length;
		try {
			await yoqa(
				"runs",
				"create",
				"shop",
				"--cases",
				"1",
				"--no-github-output",
				"--base-url",
				runner.url,
			);
		} finally {
			console.error = error;
			runner.connect(null);
		}
		expect(runner.runs).toHaveLength(before);
		expect(process.exitCode).toBe(1);
		expect(errors[0]).toContain("--device web-chrome-everyday");
		process.exitCode = 0;
	});
});
