import { afterEach, describe, expect, mock, test } from "bun:test";
import { RunnerRequestError } from "@yoqa/runner-client";

mock.module("@/app/desktop-rpc", () => ({
	getDesktopRpc: () => ({ request: { getRunnerBaseUrl: async () => "http://runner.test" } }),
}));

const { resetBrowserProfile } = await import("@/features/devices/data/api/devices");

const realFetch = globalThis.fetch;
const requests: { url: string; method: string }[] = [];

function answer(status: number, body: unknown) {
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push({ url: String(input), method: init?.method ?? "GET" });
		return new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		});
	}) as typeof fetch;
}

afterEach(() => {
	globalThis.fetch = realFetch;
	requests.length = 0;
});

describe("resetBrowserProfile", () => {
	test("deletes the App's Kept profile for one browser and answers the browsers reset", async () => {
		answer(200, { appId: "app_1", browserIds: ["web-chrome"] });
		const result = await resetBrowserProfile({ appId: "app_1", browserId: "web-chrome" });
		expect(result).toEqual({ appId: "app_1", browserIds: ["web-chrome"] });
		expect(requests).toEqual([
			{
				url: "http://runner.test/devices/web/profiles?appId=app_1&browserId=web-chrome",
				method: "DELETE",
			},
		]);
	});

	test("resets the default profile when no App is named", async () => {
		answer(200, { appId: "default", browserIds: [] });
		await resetBrowserProfile({ browserId: "web-edge" });
		expect(requests[0]?.url).toBe("http://runner.test/devices/web/profiles?browserId=web-edge");
	});

	test("rejects with the runner's refusal while the browser is open", async () => {
		const refusal =
			"web-chrome is open on the Kept profile of app_1. Disconnect it before resetting the profile.";
		answer(409, { error: refusal });
		const error = await resetBrowserProfile({ appId: "app_1", browserId: "web-chrome" }).catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(RunnerRequestError);
		expect((error as RunnerRequestError).status).toBe(409);
		expect((error as Error).message).toContain(refusal);
	});
});
