import { describe, expect, test } from "bun:test";
import {
	ConnectCancelledError,
	allowPrompt,
	allowSecondsLeft,
	connectAcceptingWarning,
	everydayBrowserName,
	everydayEntries,
	everydayRecheckInterval,
	everydayStateLine,
	everydayWarningLine,
	isConnectCancelled,
	isEverydayDeviceId,
	takeDisconnectNote,
	turnOnHint,
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
		expect(everydayBrowserName(undefined)).toBe("your browser");
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
				verified: true,
			},
			{
				id: "web-chrome-everyday",
				name: "Google Chrome (everyday)",
				browserName: "Google Chrome",
				osVersion: "everyday browser",
				kind: "browser",
				state: "remote debugging off",
				ready: false,
				verified: true,
			},
		]);
	});

	test("an unverified browser says so after its state", () => {
		const opera: Device = {
			...CHROME_OFF,
			id: "web-opera-everyday",
			name: "Opera (everyday)",
			verified: false,
		};
		const [entry] = everydayEntries([opera]);
		expect(entry?.verified).toBe(false);
		expect(entry ? everydayStateLine(entry) : null).toBe("remote debugging off · unverified");
		expect(everydayStateLine({ ...DIA_READY, verified: true })).toBe("ready");
		expect(everydayStateLine({ state: "not running", verified: false })).toBe(
			"not running · unverified",
		);
	});

	test("leaves out an attached browser, which is CLI only", () => {
		const attached: Device = { ...CHROME, id: "chromium-cdp-9222", name: "Chromium" };
		expect(everydayEntries([attached])).toEqual([]);
	});
});

describe("everydayRecheckInterval", () => {
	const chromeClosed: Device = { ...CHROME_OFF, state: "not running" };

	test("re-checks every 2 s while an Everyday browser is not ready", () => {
		expect(everydayRecheckInterval([DIA_READY, CHROME_OFF])).toBe(2_000);
		expect(everydayRecheckInterval([chromeClosed])).toBe(2_000);
	});

	test("stops once every Everyday browser is ready, or there are none", () => {
		expect(everydayRecheckInterval([DIA_READY])).toBe(false);
		expect(everydayRecheckInterval([])).toBe(false);
		expect(everydayRecheckInterval(undefined)).toBe(false);
	});

	test("launched and attached browsers don't keep it going", () => {
		const attached: Device = { ...CHROME, id: "chromium-cdp-9222", name: "Chromium" };
		expect(everydayRecheckInterval([CHROME, attached, DIA_READY])).toBe(false);
	});
});

describe("turnOnHint", () => {
	const off = { state: "remote debugging off" } as const;
	const closed = { state: "not running" } as const;

	test("with remote debugging off, says to turn it on in the page that opens", () => {
		expect(turnOnHint({ ...off, browserName: "Dia", verified: true })).toBe(
			"Turn on remote debugging in the page that opens, then come back. Your browser asks you to Allow each connect.",
		);
	});

	test("with the browser closed, says to open it first", () => {
		expect(turnOnHint({ ...closed, browserName: "Google Chrome", verified: true })).toBe(
			"Google Chrome is not running. Open the setting to start it, turn on remote debugging in the page that opens, then come back. Your browser asks you to Allow each connect.",
		);
	});

	test("an unverified browser also says to open the page by hand if it doesn't load", () => {
		expect(turnOnHint({ ...off, browserName: "Opera", verified: false })).toBe(
			"Turn on remote debugging in the page that opens, then come back. Your browser asks you to Allow each connect. If the page doesn't load, open chrome://inspect/#remote-debugging in Opera yourself.",
		);
		expect(turnOnHint({ ...closed, browserName: "Opera", verified: false })).toEndWith(
			"If the page doesn't load, open chrome://inspect/#remote-debugging in Opera yourself.",
		);
	});
});

describe("allowPrompt", () => {
	test("tells the user where to click while the runner waits", () => {
		expect(allowPrompt("Dia")).toBe("Click Allow in Dia");
	});

	test("counts down the seconds left, and drops them once none are", () => {
		expect(allowPrompt("Dia", 58)).toBe("Click Allow in Dia · 58 s");
		expect(allowPrompt("Dia", 0)).toBe("Click Allow in Dia");
	});
});

describe("allowSecondsLeft", () => {
	test("rounds up to the whole second and never goes below zero", () => {
		const deadline = 60_000;
		expect(allowSecondsLeft(deadline, 0)).toBe(60);
		expect(allowSecondsLeft(deadline, 1_500)).toBe(59);
		expect(allowSecondsLeft(deadline, 59_999)).toBe(1);
		expect(allowSecondsLeft(deadline, 60_000)).toBe(0);
		expect(allowSecondsLeft(deadline, 75_000)).toBe(0);
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

/**
 * A runner that asks for the warning until an App's connect accepts it, as the runner does,
 * and then waits `allowMs` on the user's Allow.
 */
function fakeRunner(allowMs = 0, warningMs = 0) {
	const accepted = new Set<string>();
	const requests: ConnectDeviceRequest[] = [];
	const connect = async (request: ConnectDeviceRequest) => {
		requests.push(request);
		const appId = request.appId ?? "default";
		if (request.acceptEverydayWarning) accepted.add(appId);
		if (!accepted.has(appId)) {
			await Bun.sleep(warningMs);
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
		await Bun.sleep(allowMs);
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

	test("says the runner waits on Allow only once past the warning", async () => {
		const runner = fakeRunner(60);
		const events: string[] = [];
		await connectAcceptingWarning(
			{ ...DIA, appId: "app_1" },
			{
				connect: runner.connect,
				confirm: async () => {
					events.push("warning");
					return true;
				},
				onWaiting: () => events.push("waiting"),
				waitingDelayMs: 20,
			},
		);
		expect(events).toEqual(["warning", "waiting"]);
	});

	test("an App that accepted before waits once the runner has not answered in a moment", async () => {
		const runner = fakeRunner(60);
		const deps = { connect: runner.connect, confirm: async () => true, waitingDelayMs: 20 };
		await connectAcceptingWarning({ ...DIA, appId: "app_1" }, deps);
		const events: string[] = [];
		await connectAcceptingWarning(
			{ ...DIA, appId: "app_1" },
			{ ...deps, onWaiting: () => events.push("waiting") },
		);
		expect(events).toEqual(["waiting"]);
	});

	test("a slow warning says it waits once, however many tries the connect takes", async () => {
		const runner = fakeRunner(60, 40);
		const events: string[] = [];
		await connectAcceptingWarning(
			{ ...DIA, appId: "app_1" },
			{
				connect: runner.connect,
				confirm: async () => {
					events.push("warning");
					return true;
				},
				onWaiting: () => events.push("waiting"),
				waitingDelayMs: 20,
			},
		);
		expect(events).toEqual(["waiting", "warning"]);
	});

	test("a retry that fails at once after the warning never says it waits", async () => {
		const events: string[] = [];
		let tries = 0;
		const runner = fakeRunner();
		await connectAcceptingWarning(
			{ ...DIA, appId: "app_1" },
			{
				connect: async (request) => {
					tries += 1;
					if (tries === 1) return runner.connect(request);
					throw new Error("Remote debugging is off in Dia");
				},
				confirm: async () => true,
				onWaiting: () => events.push("waiting"),
				waitingDelayMs: 20,
			},
		).catch(() => undefined);
		await Bun.sleep(40);
		expect(events).toEqual([]);
	});

	test("a connect that fails at once, or a Cancel on the warning, never says it waits", async () => {
		const events: string[] = [];
		const onWaiting = () => events.push("waiting");
		await connectAcceptingWarning(DIA, {
			connect: async () => {
				throw new Error("Dia is not running. Open it");
			},
			confirm: async () => true,
			onWaiting,
			waitingDelayMs: 20,
		}).catch(() => undefined);
		await connectAcceptingWarning(
			{ ...DIA, appId: "app_1" },
			{ connect: fakeRunner().connect, confirm: async () => false, onWaiting, waitingDelayMs: 20 },
		).catch(() => undefined);
		await Bun.sleep(40);
		expect(events).toEqual([]);
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
