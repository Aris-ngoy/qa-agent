import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CatalogApp, CatalogCase } from "@yoqa/runner-client";
import { buildProgram } from "./program";

const HINT = "Is the runner up? Try: yoqa serve";

/** A port nothing listens on: bound once, then released. */
function closedPortUrl(): string {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
	const url = `http://127.0.0.1:${server.port}`;
	server.stop(true);
	return url;
}

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

/** A runner with one App and its case, and nothing else: other requests reach it and get an error. */
function shopRunner() {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const { pathname } = new URL(request.url);
			if (pathname === "/apps") return Response.json({ apps: [APP] });
			if (pathname === `/apps/${APP.id}/cases`) return Response.json({ cases: [CASE] });
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe('the "Is the runner up?" hint', () => {
	const runner = shopRunner();
	const autostart = process.env.YOQA_NO_AUTOSTART;
	// Restored as 0 when unset: Bun keeps a failure code if `exitCode` is set back to undefined.
	const exitCode = process.exitCode ?? 0;
	const log = console.log;
	const error = console.error;
	let printed: string[] = [];

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		console.log = () => undefined;
		console.error = (...parts: unknown[]) => {
			printed.push(parts.join(" "));
		};
	});

	afterAll(() => {
		runner.stop();
		console.log = log;
		console.error = error;
		process.exitCode = exitCode;
		if (autostart === undefined) Reflect.deleteProperty(process.env, "YOQA_NO_AUTOSTART");
		else process.env.YOQA_NO_AUTOSTART = autostart;
	});

	async function yoqa(...args: string[]): Promise<string> {
		printed = [];
		process.exitCode = 0;
		await buildProgram().parseAsync(["bun", "yoqa", ...args]);
		return printed.join("\n");
	}

	test("is left out when the CLI refuses the request itself", async () => {
		const out = await yoqa(
			"runs",
			"create",
			"shop",
			"--cases",
			"1",
			"--device",
			"X",
			"--platform",
			"ios",
			"--viewport",
			"mobile",
			"--base-url",
			runner.url,
		);
		expect(out).toContain("--viewport is for web devices");
		expect(out).not.toContain(HINT);
		expect(process.exitCode).toBe(1);
	});

	test("is left out when the runner answers, whatever went wrong", async () => {
		const out = await yoqa("runs", "create", "nope", "--cases", "1", "--base-url", runner.url);
		expect(out).toContain("App not found: nope");
		expect(out).toContain("yoqa runs create failed");
		expect(out).not.toContain(HINT);
		expect(process.exitCode).toBe(1);
	});

	test("is printed when nothing answers at the runner's URL", async () => {
		const out = await yoqa("runs", "create", "shop", "--cases", "1", "--base-url", closedPortUrl());
		expect(out).toContain("yoqa runs create failed");
		expect(out).toContain(HINT);
		expect(process.exitCode).toBe(1);
	});
});
