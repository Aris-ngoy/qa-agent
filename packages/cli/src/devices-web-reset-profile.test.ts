import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CatalogApp, ResetWebProfileResponse } from "@yoqa/runner-client";
import { buildProgram } from "./program";

const APP: CatalogApp = {
	id: "app_1",
	name: "Shop",
	prefix: "SHOP",
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

/**
 * A runner with one catalog App, whose Kept profiles are in Chrome and Edge, records each
 * reset, and refuses one while Chrome has `busy`'s profile open.
 */
function fakeRunner() {
	const resets: Array<Record<string, string>> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			const url = new URL(request.url);
			if (request.method === "GET" && url.pathname === "/apps") {
				return Response.json({ apps: [APP] });
			}
			if (request.method === "GET" && url.pathname === "/devices") {
				return Response.json({ platform: "web", devices: [] });
			}
			if (request.method === "DELETE" && url.pathname === "/devices/web/profiles") {
				const query = Object.fromEntries(url.searchParams);
				resets.push(query);
				const appId = query.appId ?? "default";
				if (appId === "busy") {
					return Response.json(
						{ error: "web-chrome is open on the Kept profile of busy" },
						{ status: 409 },
					);
				}
				const browserIds = query.browserId ? [query.browserId] : ["web-chrome", "web-edge"];
				const body: ResetWebProfileResponse = {
					appId,
					browserIds: appId === "gone" ? [] : browserIds,
				};
				return Response.json(body);
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return { resets, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("yoqa devices web reset-profile", () => {
	const runner = fakeRunner();
	const autostart = process.env.YOQA_NO_AUTOSTART;
	// Restored as 0 when unset: Bun keeps a failure code if `exitCode` is set back to undefined.
	const exitCode = process.exitCode ?? 0;
	const log = console.log;
	const error = console.error;
	let printed: string[] = [];

	beforeAll(() => {
		process.env.YOQA_NO_AUTOSTART = "1";
		console.log = (...args: unknown[]) => printed.push(args.join(" "));
		console.error = (...args: unknown[]) => printed.push(args.join(" "));
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
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		return printed.join("\n");
	}

	test("with no flags it resets every browser's default Kept profile", async () => {
		const out = await yoqa("devices", "web", "reset-profile");
		expect(runner.resets.at(-1)).toEqual({});
		expect(out).toContain("reset the Kept profile for default in web-chrome, web-edge");
	});

	test("--app names the App by its prefix or id, and --browser one browser", async () => {
		await yoqa("devices", "web", "reset-profile", "--app", "shop");
		expect(runner.resets.at(-1)).toEqual({ appId: "app_1" });
		const out = await yoqa(
			"devices",
			"web",
			"reset-profile",
			"--app",
			"app_1",
			"--browser",
			"web-edge",
		);
		expect(runner.resets.at(-1)).toEqual({ appId: "app_1", browserId: "web-edge" });
		expect(out).toContain("reset the Kept profile for app_1 in web-edge");
	});

	test("an App the catalog no longer has is reset by the id given", async () => {
		const out = await yoqa("devices", "web", "reset-profile", "--app", "gone");
		expect(runner.resets.at(-1)).toEqual({ appId: "gone" });
		expect(out).toContain("No Kept profile for gone to reset.");
	});

	test("a profile whose browser is open is refused, and says so", async () => {
		const out = await yoqa("devices", "web", "reset-profile", "--app", "busy");
		expect(out).toContain("yoqa devices web reset-profile failed: web-chrome is open");
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});

	test("an App id that is not a folder name fails before the runner is asked", async () => {
		const before = runner.resets.length;
		const out = await yoqa("devices", "web", "reset-profile", "--app", "../x");
		expect(out).toContain("yoqa devices web reset-profile failed");
		expect(runner.resets).toHaveLength(before);
		process.exitCode = 0;
	});

	test("devices web still lists the browsers", async () => {
		const out = await yoqa("devices", "web");
		expect(out).toContain("No devices found.");
		expect(runner.resets).not.toContainEqual({ appId: "web" });
	});
});
