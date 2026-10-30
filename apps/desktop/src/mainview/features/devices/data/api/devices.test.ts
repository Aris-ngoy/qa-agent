import { afterEach, describe, expect, mock, test } from "bun:test";
import { RunnerRequestError } from "@yoqa/runner-client";

const settingsOpened: { browserId: string }[] = [];
let settingResult: { ok: true } | { ok: false; error: string } = { ok: true };

mock.module("@/app/desktop-rpc", () => ({
	getDesktopRpc: () => ({
		request: {
			getRunnerBaseUrl: async () => "http://runner.test",
			openRemoteDebuggingSetting: async (params: { browserId: string }) => {
				settingsOpened.push(params);
				return settingResult;
			},
		},
	}),
}));

const { connectDevice, openRemoteDebuggingSetting, resetBrowserProfile } = await import(
	"@/features/devices/data/api/devices"
);

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
	settingsOpened.length = 0;
	settingResult = { ok: true };
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

describe("connectDevice", () => {
	test("Cancel while the runner waits for Allow aborts the connect request", async () => {
		let seen: AbortSignal | undefined;
		globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
			seen = init?.signal ?? undefined;
			return new Promise<Response>((_resolve, reject) => {
				if (seen?.aborted) reject(seen.reason);
				seen?.addEventListener("abort", () => reject(seen?.reason));
			});
		}) as typeof fetch;
		const controller = new AbortController();
		const connecting = connectDevice(
			{ deviceId: "web-dia-everyday", platform: "web", acceptEverydayWarning: true },
			{ signal: controller.signal },
		).catch((caught: unknown) => caught);
		controller.abort();
		const error = await connecting;
		expect(seen?.aborted).toBe(true);
		expect((error as Error).name).toBe("AbortError");
	});
});

describe("openRemoteDebuggingSetting", () => {
	test("asks the desktop host to open the setting in that browser", async () => {
		await openRemoteDebuggingSetting("web-dia-everyday");
		expect(settingsOpened).toEqual([{ browserId: "web-dia-everyday" }]);
	});

	test("rejects with the host's reason when the browser could not open it", async () => {
		settingResult = { ok: false, error: "open exited with code 1" };
		const error = await openRemoteDebuggingSetting("web-dia-everyday").catch(
			(caught: unknown) => caught,
		);
		expect((error as Error).message).toBe("open exited with code 1");
	});
});
