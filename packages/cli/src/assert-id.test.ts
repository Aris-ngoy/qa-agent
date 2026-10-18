import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ScreenResponse } from "@yoqa/runner-client";
import { buildProgram } from "./program";

/** A runner whose Screen holds one button with an id, and that counts its Screen reads. */
function fakeRunner() {
	let reads = 0;
	const screen: ScreenResponse = {
		full: false,
		window: { width: 390, height: 844 },
		elements: [
			{ type: "Button", label: "Skip", id: "onboarding-skip", x: 0, y: 0, width: 10, height: 10 },
		],
	};
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: (request) => {
			if (new URL(request.url).pathname === "/screen") {
				reads += 1;
				return Response.json(screen);
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	});
	return {
		reads: () => reads,
		url: `http://127.0.0.1:${server.port}`,
		stop: () => server.stop(true),
	};
}

describe("yoqa assert --id", () => {
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

	/** Run `yoqa …` and return what it printed and the exit code it set. */
	async function yoqa(...args: string[]): Promise<{ out: string; code: number }> {
		printed = [];
		process.exitCode = 0;
		await buildProgram().parseAsync(["bun", "yoqa", ...args, "--base-url", runner.url]);
		const code = Number(process.exitCode ?? 0);
		process.exitCode = exitCode;
		return { out: printed.join("\n"), code };
	}

	test("passes when the id is on the Screen", async () => {
		expect(await yoqa("assert", "visible", "--id", "Onboarding-Skip")).toEqual({
			out: "ok assert visible",
			code: 0,
		});
	});

	test("fails non-zero when the id is missing, or still there for not-visible", async () => {
		const missing = await yoqa("assert", "visible", "--id", "skip", "--timeout", "0");
		expect(missing.code).toBe(1);
		expect(missing.out).toContain("Expected visible id not found within 0s: skip");

		const present = await yoqa(
			"assert",
			"not-visible",
			"--id",
			"onboarding-skip",
			"--timeout",
			"0",
		);
		expect(present.code).toBe(1);
		expect(present.out).toContain("Unexpected id still visible after 0s: onboarding-skip");
	});

	test("exits 2, not 1, when the runner cannot be reached, so a Branch does not take else", async () => {
		const gone = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
		const url = `http://127.0.0.1:${gone.port}`;
		gone.stop(true);
		printed = [];
		process.exitCode = 0;
		await buildProgram().parseAsync([
			"bun",
			"yoqa",
			"assert",
			"visible",
			"--id",
			"onboarding-skip",
			"--timeout",
			"0",
			"--base-url",
			url,
		]);
		const code = Number(process.exitCode ?? 0);
		process.exitCode = exitCode;
		expect(code).toBe(2);
		expect(printed.join("\n")).toContain("Could not read the screen within 0s");
	});

	test("rejects --text with --id, and neither, without reading the Screen", async () => {
		const before = runner.reads();
		const both = await yoqa("assert", "visible", "--text", "Skip", "--id", "onboarding-skip");
		expect(both.code).toBe(2);
		expect(both.out).toBe("yoqa assert visible failed: pass --text or --id, not both");

		const neither = await yoqa("assert", "visible");
		expect(neither.code).toBe(2);
		expect(neither.out).toBe("yoqa assert visible failed: pass --text <text> or --id <id>");
		expect(runner.reads()).toBe(before);
	});
});
