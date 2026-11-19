import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ActionRequest, ActionResponse } from "@yoqa/runner-client";
import { buildProgram } from "./program";

/**
 * A runner whose device is an iOS simulator with `com.example.app` on it: it records each
 * Action and answers a Reset as that Lane does. Any other App is on a cabled iPhone, which
 * cannot Reset.
 */
function fakeRunner() {
	const actions: ActionRequest[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			// The output seam asks which Device Session to account to; this runner has none.
			if (new URL(request.url).pathname === "/devices/active") {
				return new Response(null, { status: 404 });
			}
			const body = (await request.json()) as ActionRequest;
			actions.push(body);
			if (body.appId !== "com.example.app") {
				return Response.json(
					{
						error: "Action not supported",
						detail: "A cabled iPhone cannot clear an app's data without reinstalling it",
					},
					{ status: 422 },
				);
			}
			const cleared = ["data", "cache", "preferences", "permissions", "app-groups"] as const;
			const response: ActionResponse = {
				ok: true,
				kind: body.kind,
				reset: body.keychain
					? { cleared: [...cleared, "keychain"], kept: [] }
					: { cleared: [...cleared], kept: ["keychain"] },
			};
			return Response.json(response);
		},
	});
	return { actions, url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("yoqa action reset-app", () => {
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

	test("resets the App and prints what was cleared and what was kept", async () => {
		const out = await yoqa("action", "reset-app", "--app-id", "com.example.app");
		expect(runner.actions.at(-1)).toEqual({ kind: "reset-app", appId: "com.example.app" });
		expect(out).toBe(
			[
				"ok reset-app",
				"cleared data, cache, preferences, permissions, app-groups",
				"kept keychain",
			].join("\n"),
		);
	});

	test("--keychain asks for the keychain too, and prints no kept line when nothing was kept", async () => {
		const out = await yoqa("action", "reset-app", "--app-id", "com.example.app", "--keychain");
		expect(runner.actions.at(-1)).toEqual({
			kind: "reset-app",
			appId: "com.example.app",
			keychain: true,
		});
		expect(out).toBe(
			["ok reset-app", "cleared data, cache, preferences, permissions, app-groups, keychain"].join(
				"\n",
			),
		);
	});

	test("--json prints the runner's response, with the cleared and kept lists", async () => {
		const out = await yoqa("action", "reset-app", "--app-id", "com.example.app", "--json");
		expect(JSON.parse(out)).toMatchObject({
			ok: true,
			kind: "reset-app",
			reset: { kept: ["keychain"] },
		});
	});

	test("a Lane that cannot Reset fails with its reason", async () => {
		const out = await yoqa("action", "reset-app", "--app-id", "com.example.shop");
		expect(out).toContain("A cabled iPhone cannot clear an app's data without reinstalling it");
		expect(process.exitCode).toBe(1);
		process.exitCode = exitCode;
	});
});
