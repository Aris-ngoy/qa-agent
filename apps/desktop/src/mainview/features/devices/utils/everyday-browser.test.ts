import { describe, expect, test } from "bun:test";
import {
	ConnectCancelledError,
	allowPrompt,
	connectAcceptingWarning,
	everydayBrowserName,
	everydayEntries,
	everydayWarningLine,
	isConnectCancelled,
	isEverydayDeviceId,
	takeDisconnectNote,
} from "@/features/devices/utils/everyday-browser";
import {
	type ActiveDeviceResponse,
	type ConnectDeviceRequest,
	type Device,
	RunnerRequestError,
} from "@yoqa/runner-client";

const DIA_READY: Device = {
	id: "web-dia-everyday",
	name: "Dia (everyday)",
	osVersion: "everyday browser",
	platform: "web",
	kind: "browser",
	state: "ready",
};
const CHROME_OFF: Device = {
	...DIA_READY,
	id: "web-chrome-everyday",
	name: "Google Chrome (everyday)",
	state: "remote debugging off",
};
const CHROME: Device = {
	id: "web-chrome",
	name: "Google Chrome",
	osVersion: "144.0",
	platform: "web",
	kind: "browser",
	state: "not running",
};

describe("isEverydayDeviceId", () => {
	test("is a user's own browser by consent, not a launched or attached one", () => {
		expect(isEverydayDeviceId("web-dia-everyday")).toBe(true);
		expect(isEverydayDeviceId("web-chrome-everyday")).toBe(true);
		expect(isEverydayDeviceId("web-chrome")).toBe(false);
		expect(isEverydayDeviceId("chromium-cdp-9222")).toBe(false);
	});
});

describe("everydayBrowserName", () => {
	test("is the browser as the user knows it, without the list's tag", () => {
		expect(everydayBrowserName("Dia (everyday)")).toBe("Dia");
		expect(everydayBrowserName("Google Chrome")).toBe("Google Chrome");
	});
});

describe("everydayEntries", () => {
	test("is one entry per installed browser, ready or off, from the runner's list", () => {
		expect(everydayEntries([CHROME, DIA_READY, CHROME_OFF])).toEqual([
			{
				id: "web-dia-everyday",
				name: "Dia (everyday)",
				browserName: "Dia",
				osVersion: "everyday browser",
				kind: "browser",
				state: "ready",
				ready: true,
			},
			{
				id: "web-chrome-everyday",
				name: "Google Chrome (everyday)",
				browserName: "Google Chrome",
				osVersion: "everyday browser",
				kind: "browser",
				state: "remote debugging off",
				ready: false,
			},
		]);
	});

	test("leaves out an attached browser, which is CLI only", () => {
		const attached: Device = { ...CHROME, id: "chromium-cdp-9222", name: "Chromium" };
		expect(everydayEntries([attached])).toEqual([]);
	});
});

describe("allowPrompt", () => {
	test("tells the user where to click while the runner waits", () => {
		expect(allowPrompt("Dia")).toBe("Click Allow in Dia");
	});
});

describe("everydayWarningLine", () => {
	test("names the signed-in browser the agent will act in", () => {
		expect(everydayWarningLine("Dia")).toBe(
			"The agent will act in your signed-in Dia. It can read and change anything your accounts there can.",
		);
	});
});

const SESSION = { deviceId: "web-dia-everyday" } as ActiveDeviceResponse;

/** A runner that asks for the warning until an App's connect accepts it, as the runner does. */
function fakeRunner() {
	const accepted = new Set<string>();
	const requests: ConnectDeviceRequest[] = [];
	const connect = async (request: ConnectDeviceRequest) => {
		requests.push(request);
		const appId = request.appId ?? "default";
		if (request.acceptEverydayWarning) accepted.add(appId);
		if (!accepted.has(appId)) {
			throw new RunnerRequestError(
				"needs the warning",
				428,
				{
					error: "needs the warning",
					code: "EVERYDAY_WARNING_REQUIRED",
					appId,
					warning: "Yoqa will drive your Everyday browser, signed in as you.",
				},
				{ url: "http://runner.test/devices/connect", runnerPid: null, date: null },
			);
		}
		return SESSION;
	};
	return { connect, requests };
}

const DIA = { deviceId: "web-dia-everyday", platform: "web" } as const;

describe("connectAcceptingWarning", () => {
	test("shows the warning once per App, then connects with it accepted", async () => {
		const runner = fakeRunner();
		const warnings: string[] = [];
		const confirm = async (warning: { appId: string; warning: string }) => {
			warnings.push(warning.appId);
			return true;
		};
		const connect = (appId: string) =>
			connectAcceptingWarning({ ...DIA, appId }, { connect: runner.connect, confirm });

		expect(await connect("app_1")).toBe(SESSION);
		expect(await connect("app_1")).toBe(SESSION);
		expect(await connect("app_2")).toBe(SESSION);
		expect(warnings).toEqual(["app_1", "app_2"]);
		expect(runner.requests.map((request) => request.acceptEverydayWarning ?? false)).toEqual([
			false,
			true,
			false,
			false,
			true,
		]);
	});

	test("Cancel on the warning connects nothing and asks again next time", async () => {
		const runner = fakeRunner();
		let answers = [false, true];
		const confirm = async () => {
			const [answer, ...rest] = answers;
			answers = rest;
			return answer ?? false;
		};
		const first = await connectAcceptingWarning(
			{ ...DIA, appId: "app_1" },
			{ connect: runner.connect, confirm },
		).catch((caught: unknown) => caught);
		expect(first).toBeInstanceOf(ConnectCancelledError);
		expect(runner.requests).toHaveLength(1);
		expect(
			await connectAcceptingWarning(
				{ ...DIA, appId: "app_1" },
				{ connect: runner.connect, confirm },
			),
		).toBe(SESSION);
	});

	test("passes any other connect error on as it is", async () => {
		const denied = new Error("Remote debugging was denied in Dia");
		const error = await connectAcceptingWarning(DIA, {
			connect: async () => {
				throw denied;
			},
			confirm: async () => true,
		}).catch((caught: unknown) => caught);
		expect(error).toBe(denied);
	});
});

describe("isConnectCancelled", () => {
	test("is a Cancel on the warning or while waiting for Allow, not a failure", () => {
		expect(isConnectCancelled(new ConnectCancelledError())).toBe(true);
		expect(isConnectCancelled(new DOMException("The operation was aborted.", "AbortError"))).toBe(
			true,
		);
		expect(isConnectCancelled(new Error("Remote debugging was denied in Dia"))).toBe(false);
	});
});

function memoryStorage() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			items.set(key, value);
		},
	};
}

describe("takeDisconnectNote", () => {
	test("says once, after the first disconnect, that the toggle is still on", () => {
		const storage = memoryStorage();
		expect(takeDisconnectNote("web-dia-everyday", "Dia", storage)).toBe(
			"Remote debugging is still on in Dia. Turn it off at chrome://inspect/#remote-debugging when you no longer want Yoqa to connect.",
		);
		expect(takeDisconnectNote("web-dia-everyday", "Dia", storage)).toBeNull();
		expect(takeDisconnectNote("web-chrome-everyday", "Google Chrome", storage)).toBeNull();
	});

	test("is nothing for a browser Yoqa launched", () => {
		const storage = memoryStorage();
		expect(takeDisconnectNote("web-chrome", "Google Chrome", storage)).toBeNull();
		expect(takeDisconnectNote("web-dia-everyday", "Dia", storage)).not.toBeNull();
	});
});
