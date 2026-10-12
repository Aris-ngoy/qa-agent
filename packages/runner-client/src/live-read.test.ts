import { describe, expect, test } from "bun:test";
import { RunnerClient } from "./index";

describe("live device reads", () => {
	test("screen and screenshot reads skip the HTTP cache", async () => {
		const calls: Array<{ url: string; cache?: RequestCache }> = [];
		// Bun's fetch also has preconnect; the client only calls it as a function.
		const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), cache: init?.cache });
			const url = String(input);
			const body = url.includes("/screenshot/image")
				? new Uint8Array([1, 2, 3])
				: JSON.stringify({ full: false, window: { width: 1, height: 1 }, elements: [] });
			return Promise.resolve(
				new Response(body, {
					status: 200,
					headers: {
						"Content-Type": url.includes("/screenshot/image") ? "image/png" : "application/json",
					},
				}),
			);
		}) as typeof fetch;
		const client = new RunnerClient({ baseUrl: "http://127.0.0.1:7420", fetchImpl });
		await client.getScreen();
		await client.fetchScreenshotBytes();
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toMatch(/\/screen\?_=\d+$/);
		expect(calls[0]?.cache).toBe("no-store");
		expect(calls[1]?.url).toMatch(/\/screenshot\/image\?_=\d+$/);
		expect(calls[1]?.cache).toBe("no-store");
	});
});
