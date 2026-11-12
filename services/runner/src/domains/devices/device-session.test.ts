import { describe, expect, test } from "bun:test";
import { readFile, unlink } from "node:fs/promises";
import {
	type LaneDriver,
	type Point,
	composeDeviceSession,
	createActionLock,
} from "./device-session";
import { ActionUnsupportedError, UnsupportedKeyError } from "./lane";
import { SCREENSHOT_DIR } from "./screenshot-retention";

/**
 * The Device Session's shared behaviour, tested once here through its interface over a
 * fake driver. What each Lane does on its own device is the Lane contract's
 * (`lane-contract.test.ts`).
 */

/** A driver that records what reached it, as `name(args)`. */
function fakeDriver(overrides: Partial<LaneDriver> = {}) {
	const calls: string[] = [];
	const record =
		(name: string) =>
		async (...args: unknown[]) => {
			calls.push(`${name}(${args.map((arg) => JSON.stringify(arg)).join(",")})`);
		};
	let target: string | undefined;
	const driver: LaneDriver = {
		stream: null,
		capabilities: {
			keys: { keys: ["Enter", "Tab"], modifiers: false },
			targetApp: true,
			unsupported: {},
		},
		where: "on the fake device",
		quit: async () => undefined,
		captureFrame: async () => ({
			base64: Buffer.from("frame").toString("base64"),
			mime: "image/png",
		}),
		pageSource: async () => "{}",
		getWindowSize: async () => ({ width: 100, height: 200 }),
		tap: record("tap"),
		swipe: record("swipe"),
		drag: record("drag"),
		type: record("type"),
		key: record("key"),
		activateApp: record("activateApp"),
		terminateApp: record("terminateApp"),
		setTargetApp: (appId) => {
			target = appId;
		},
		targetApp: () => target,
		startRecording: async () => ({ stop: async () => undefined }),
		backgroundApp: record("backgroundApp"),
		reloadPage: record("reloadPage"),
		openUrl: record("openUrl"),
		acceptAlert: record("acceptAlert"),
		dismissAlert: record("dismissAlert"),
		pointer: {
			kind: "gesture",
			tap: async (point: Point) => {
				calls.push(`pointer tap ${point.x},${point.y}`);
			},
			swipe: async (from: Point, to: Point) => {
				calls.push(`pointer swipe ${from.x},${from.y} -> ${to.x},${to.y}`);
			},
		},
		...overrides,
	};
	return { driver, calls };
}

describe("the action lock", () => {
	test("runs Actions one at a time, in the order they were asked for", async () => {
		const order: string[] = [];
		const { driver } = fakeDriver({
			tap: async () => {
				await Bun.sleep(20);
				order.push("tap");
			},
			terminateApp: async () => {
				order.push("terminate");
			},
			type: async () => {
				order.push("type");
			},
		});
		const session = composeDeviceSession(driver);
		await Promise.all([session.tap(1, 2), session.terminateApp("app"), session.type("x")]);
		expect(order).toEqual(["tap", "terminate", "type"]);
	});

	test("an Action that fails does not stop the next one", async () => {
		const { driver, calls } = fakeDriver({
			tap: async () => {
				throw new Error("tap failed");
			},
		});
		const session = composeDeviceSession(driver);
		const failed = session.tap(1, 2).catch((error: Error) => error.message);
		await session.type("after");
		expect(await failed).toBe("tap failed");
		expect(calls).toEqual(['type("after")']);
	});

	test("reads take no lock: a frame comes back while an Action is still running", async () => {
		let release = () => {};
		const { driver } = fakeDriver({
			tap: () =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		});
		const session = composeDeviceSession(driver);
		const tapped = session.tap(1, 2);
		expect((await session.captureFrame()).mime).toBe("image/png");
		release();
		await tapped;
	});

	test("hooks run as an Action is asked for, before it runs, and after it settles", async () => {
		const order: string[] = [];
		const lock = createActionLock({
			queued: () => order.push("queued"),
			ready: async () => order.push("ready"),
			settled: () => order.push("settled"),
		});
		await lock(async () => {
			order.push("run");
		});
		await Bun.sleep(0);
		expect(order).toEqual(["queued", "ready", "run", "settled"]);
	});
});

describe("the screenshot", () => {
	test("is the driver's frame, written once under the run screenshots directory", async () => {
		const { driver } = fakeDriver();
		const shot = await composeDeviceSession(driver).screenshot();
		try {
			expect(shot.path.startsWith(SCREENSHOT_DIR)).toBe(true);
			expect(shot.base64).toBe(Buffer.from("frame").toString("base64"));
			expect(await readFile(shot.path, "utf8")).toBe("frame");
		} finally {
			await unlink(shot.path).catch(() => undefined);
		}
	});
});

describe("the live pointer", () => {
	test("a press and release in one place is one tap, and the pointer is active in between", async () => {
		const { driver, calls } = fakeDriver();
		const session = composeDeviceSession(driver);
		await session.pointerEvent("begin", 300, 400, 1);
		expect(session.isPointerActive()).toBe(true);
		await session.pointerEvent("end", 300, 400, 2);
		expect(session.isPointerActive()).toBe(false);
		expect(calls).toEqual(["pointer tap 300,400"]);
	});

	test("a press, moves and a release elsewhere is one swipe from the press to the release", async () => {
		const { driver, calls } = fakeDriver();
		const session = composeDeviceSession(driver);
		await session.pointerEvent("begin", 100, 100, 1);
		await session.pointerEvent("move", 200, 200, 2);
		await session.pointerEvent("end", 300, 300, 3);
		expect(calls).toEqual(["pointer swipe 100,100 -> 300,300"]);
	});

	test("a release with no press swipes from the first move, or taps where it is", async () => {
		const { driver, calls } = fakeDriver();
		const session = composeDeviceSession(driver);
		await session.pointerEvent("move", 10, 10, 1);
		await session.pointerEvent("end", 20, 20, 2);
		await session.pointerEvent("end", 50, 50, 3);
		expect(calls).toEqual(["pointer swipe 10,10 -> 20,20", "pointer tap 50,50"]);
	});

	test("points are compared in the driver's own units", async () => {
		const { driver, calls } = fakeDriver({
			pointer: {
				kind: "gesture",
				// Two 0–1000 points on one device pixel.
				at: async (x, y) => ({ x: Math.round(x / 100), y: Math.round(y / 100) }),
				tap: async (point) => {
					calls.push(`pointer tap ${point.x},${point.y}`);
				},
				swipe: async () => {
					calls.push("pointer swipe");
				},
			},
		});
		const session = composeDeviceSession(driver);
		await session.pointerEvent("begin", 500, 500, 1);
		await session.pointerEvent("end", 510, 490, 2);
		expect(calls).toEqual(["pointer tap 5,5"]);
	});

	test("a live pointer reaches the driver as each phase comes", async () => {
		const phases: string[] = [];
		const { driver } = fakeDriver({
			pointer: {
				kind: "live",
				press: async (point) => {
					phases.push(`press ${point.x}`);
				},
				move: async (point) => {
					phases.push(`move ${point.x}`);
				},
				release: async (point) => {
					phases.push(`release ${point.x}`);
				},
			},
		});
		const session = composeDeviceSession(driver);
		await session.pointerEvent("begin", 1, 0, 1);
		expect(session.isPointerActive()).toBe(true);
		await session.pointerEvent("move", 2, 0, 2);
		await session.pointerEvent("end", 3, 0, 3);
		expect(session.isPointerActive()).toBe(false);
		expect(phases).toEqual(["press 1", "move 2", "release 3"]);
	});
});

describe("keys", () => {
	test("a key the Lane declares reaches the driver", async () => {
		const { driver, calls } = fakeDriver();
		await composeDeviceSession(driver).key("Enter");
		expect(calls).toEqual(['key("Enter",[])']);
	});

	test("an undeclared key, or a modifier the Lane cannot hold, fails naming where and reaches nothing", async () => {
		const { driver, calls } = fakeDriver();
		const session = composeDeviceSession(driver);
		const unknown = await session.key("Escape").catch((error: unknown) => error);
		expect(unknown).toBeInstanceOf(UnsupportedKeyError);
		expect((unknown as Error).message).toContain("on the fake device");
		const held = await session.key("Enter", ["Shift"]).catch((error: unknown) => error);
		expect(held).toBeInstanceOf(UnsupportedKeyError);
		expect(calls).toEqual([]);
	});
});

describe("restart-app", () => {
	test("without a restart of its own, a Lane terminates then activates, and keeps the storage", async () => {
		const { driver, calls } = fakeDriver();
		const result = await composeDeviceSession(driver).restartApp("com.example.app");
		expect(result).toEqual({ storage: "kept" });
		expect(calls).toEqual(['terminateApp("com.example.app")', 'activateApp("com.example.app")']);
	});

	test("a Lane's own restart is used, and says what it did with the storage", async () => {
		const { driver, calls } = fakeDriver({
			restartApp: async () => ({ storage: "cleared" }),
		});
		expect(await composeDeviceSession(driver).restartApp("app")).toEqual({ storage: "cleared" });
		expect(calls).toEqual([]);
	});
});

describe("the target app", () => {
	test("a Lane that does not remember one never names one", () => {
		const { driver } = fakeDriver({
			capabilities: {
				keys: { keys: ["Enter"], modifiers: false },
				targetApp: false,
				unsupported: {},
			},
			targetApp: undefined,
			setTargetApp: () => undefined,
		});
		const session = composeDeviceSession(driver);
		session.setTargetApp("com.example.app");
		expect(session.targetApp()).toBeUndefined();
	});
});

describe("unsupported members", () => {
	const unsupported = {
		startRecording: "No video here",
		backgroundApp: "No background here",
		reloadPage: "No page here",
		openUrl: "No URLs here",
		acceptAlert: "No alerts here",
		dismissAlert: "No alerts here either",
	};

	test("reject with ActionUnsupportedError and the Lane's reason, without waiting for an Action in flight", async () => {
		const { driver } = fakeDriver({
			capabilities: { keys: { keys: ["Enter"], modifiers: false }, targetApp: true, unsupported },
			startRecording: undefined,
			backgroundApp: undefined,
			reloadPage: undefined,
			openUrl: undefined,
			acceptAlert: undefined,
			dismissAlert: undefined,
			tap: () => new Promise<void>(() => {}),
		});
		const session = composeDeviceSession(driver);
		void session.tap(1, 2);
		const attempts = [
			() => session.startRecording("/tmp/x.mp4"),
			() => session.backgroundApp(),
			() => session.reloadPage(),
			() => session.openUrl("https://example.com"),
			() => session.acceptAlert(),
			() => session.dismissAlert(),
		];
		const errors = await Promise.all(
			attempts.map((attempt) => attempt().catch((error: unknown) => error)),
		);
		for (const error of errors) expect(error).toBeInstanceOf(ActionUnsupportedError);
		expect(errors.map((error) => (error as Error).message)).toEqual(Object.values(unsupported));
	});

	test("a driver that both implements a member and declares it unsupported fails to build", () => {
		const { driver } = fakeDriver({
			capabilities: {
				keys: { keys: ["Enter"], modifiers: false },
				targetApp: true,
				unsupported: { openUrl: "No URLs here" },
			},
		});
		expect(() => composeDeviceSession(driver)).toThrow(/openUrl.*both/);
	});

	test("a driver that neither implements a member nor declares why fails to build", () => {
		const { driver } = fakeDriver({ backgroundApp: undefined });
		expect(() => composeDeviceSession(driver)).toThrow(/backgroundApp.*neither/);
	});
});
