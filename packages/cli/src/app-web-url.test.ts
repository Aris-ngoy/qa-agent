import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CatalogApp } from "@yoqa/runner-client";
import { buildProgram } from "./program";

/** A runner whose catalog keeps Apps in memory and records each create and update body. */
function fakeRunner() {
	const apps: CatalogApp[] = [];
	const bodies: Array<{ method: string; body: Record<string, unknown> }> = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const { pathname } = new URL(request.url);
			if (request.method === "GET" && pathname === "/apps") return Response.json({ apps });
			const found = apps.find((candidate) => pathname === `/apps/${candidate.id}`);
			if (request.method === "GET" && found) return Response.json(found);
			const body = (await request.json()) as Record<string, unknown>;
			bodies.push({ method: request.method, body });
			if (request.method === "POST" && pathname === "/apps") {
				const app: CatalogApp = {
					id: `app_${apps.length + 1}`,
					name: String(body.name),
					prefix: String(body.prefix ?? body.name).toLowerCase(),
					context: "",
					knowledge: "",
					iosBundleId: "",
					iosAppStoreId: "",
					androidApplicationId: "",
					webUrl: String(body.webUrl ?? ""),
					capabilities: [],
					createdAt: 1,
					updatedAt: 1,
				};
				apps.push(app);
				return Response.json(app, { status: 201 });
			}
			if (request.method === "PATCH" && found) {
				Object.assign(found, body);
				return Response.json(found);
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return { apps, bodies, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

async function yoqa(...args: string[]): Promise<void> {
	await buildProgram().parseAsync(["bun", "yoqa", ...args]);
}

describe("yoqa apps --web-url", () => {
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

	test("create makes a web-only App from a name and a Web URL, in one request", async () => {
		await yoqa(
			"apps",
			"create",
			"--name",
			"Shop",
			"--web-url",
			"https://shop.example.com",
			"--base-url",
			runner.url,
		);
		expect(runner.bodies).toEqual([
			{ method: "POST", body: { name: "Shop", webUrl: "https://shop.example.com" } },
		]);
		expect(runner.apps[0]?.webUrl).toBe("https://shop.example.com");
	});

	test("update sets the Web URL of an existing App", async () => {
		await yoqa(
			"apps",
			"update",
			"shop",
			"--web-url",
			"http://localhost:8081",
			"--base-url",
			runner.url,
		);
		expect(runner.bodies.at(-1)).toEqual({
			method: "PATCH",
			body: { webUrl: "http://localhost:8081" },
		});
		expect(runner.apps[0]?.webUrl).toBe("http://localhost:8081");
	});

	test("get shows the Web URL", async () => {
		const lines: string[] = [];
		console.log = (...parts: unknown[]) => {
			lines.push(parts.join(" "));
		};
		await yoqa("apps", "get", "shop", "--base-url", runner.url);
		console.log = () => undefined;
		expect(lines).toContain("web_url: http://localhost:8081");
	});
});
