import { describe, expect, test } from "bun:test";
import type { AndroidDevtools, DevtoolsNode, StartAndroidDevtools } from "./android-devtools";
import type { AdbExec, AdbResult } from "./android-direct-lane";
import { createAndroidDirectSession } from "./android-direct-lane";
import { getScreen } from "./interaction";

const WINDOW = { width: 1080, height: 2400 };

/** One window as `uiautomator dump` reports it, in pixels. */
const DUMP = `<?xml version="1.0"?><hierarchy rotation="0"><node class="android.widget.FrameLayout" bounds="[0,0][1080,2400]"><node class="android.widget.Button" text="Allow" resource-id="com.android.permissioncontroller:id/permission_allow_button" content-desc="" enabled="true" bounds="[108,1200][540,1344]" /><node class="android.widget.EditText" text="hello" resource-id="com.demo:id/name" content-desc="Name" enabled="false" bounds="[54,300][1026,420]" /></node></hierarchy>`;

/** The same window as the helper reports it, bounds in 0.0–1.0 of the display. */
const HELPER_NODES: DevtoolsNode[] = [
	{
		role: "android.widget.FrameLayout",
		bounds: { x: 0, y: 0, width: 1, height: 1 },
		enabled: true,
	},
	{
		role: "android.widget.Button",
		value: "Allow",
		id: "com.android.permissioncontroller:id/permission_allow_button",
		bounds: { x: 108 / 1080, y: 1200 / 2400, width: 432 / 1080, height: 144 / 2400 },
		enabled: true,
	},
	{
		role: "android.widget.EditText",
		label: "Name",
		value: "hello",
		id: "com.demo:id/name",
		bounds: { x: 54 / 1080, y: 300 / 2400, width: 972 / 1080, height: 120 / 2400 },
		enabled: false,
	},
];

function ok(stdout = ""): AdbResult {
	return { stdout, stderr: "", exitCode: 0 };
}

/** `helperLeftRunning`: a crashed runner left the helper holding the device's UiAutomation. */
function fakeAdb(options: { helperLeftRunning?: boolean } = {}): {
	adb: AdbExec;
	calls: string[][];
} {
	const calls: string[][] = [];
	let helperRunning = options.helperLeftRunning ?? false;
	const adb: AdbExec = async (args) => {
		calls.push(args);
		const joined = args.join(" ");
		if (joined.includes("am force-stop yoqa.android.devtools")) helperRunning = false;
		if (joined.includes("uiautomator dump") && helperRunning) {
			return { stdout: "", stderr: "UiAutomationService already registered!", exitCode: 1 };
		}
		if (joined.includes("get-state")) return ok("device\n");
		if (joined.includes("wm size")) return ok(`Physical size: ${WINDOW.width}x${WINDOW.height}\n`);
		if (joined.includes("uiautomator dump")) return ok("UI hierchary dumped\n");
		if (joined.includes("cat") && joined.includes("yoqa-window.xml")) return ok(DUMP);
		return ok();
	};
	return { adb, calls };
}

type FakeHelper = AndroidDevtools & { stops: number; failTree: boolean };

function fakeHelper(
	nodes: DevtoolsNode[] = HELPER_NODES,
	display?: { width: number; height: number },
): FakeHelper {
	const helper: FakeHelper = {
		stops: 0,
		failTree: false,
		tree: async () => {
			if (helper.failTree) throw new Error("helper connection reset");
			return { nodes, display };
		},
		stop: async () => {
			helper.stops += 1;
		},
	};
	return helper;
}

async function open(devtools?: StartAndroidDevtools, adbOptions?: { helperLeftRunning?: boolean }) {
	const { adb, calls } = fakeAdb(adbOptions);
	const session = await createAndroidDirectSession(
		{ platform: "android", deviceId: "emulator-5554", appCaps: [], caseCaps: [] },
		{ adb, resolveSerial: async () => "emulator-5554", ...(devtools ? { devtools } : {}) },
	);
	const dumps = () => calls.filter((args) => args.includes("uiautomator")).length;
	return { session, dumps };
}

async function elements(session: Awaited<ReturnType<typeof open>>["session"]) {
	const screen = await getScreen(session, { pauseMjpeg: false });
	if (screen.full) throw new Error("expected the cleaned Screen");
	return screen.elements;
}

describe("Android Direct lane: tree from the instrumentation helper", () => {
	test("the helper's Screen matches the uiautomator dump of the same window", async () => {
		const fromDump = await elements((await open()).session);
		const viaHelper = await open(async () => fakeHelper());
		const fromHelper = await elements(viaHelper.session);

		expect(fromHelper).toEqual(fromDump);
		expect(fromHelper).toEqual([
			expect.objectContaining({
				type: "android.widget.Button",
				label: "Allow",
				id: "com.android.permissioncontroller:id/permission_allow_button",
				x: 100,
				y: 500,
				width: 400,
				height: 60,
				enabled: true,
			}),
			expect.objectContaining({
				type: "android.widget.EditText",
				label: "Name",
				id: "com.demo:id/name",
				x: 50,
				y: 125,
				width: 900,
				height: 50,
				enabled: false,
			}),
		]);
		expect(viaHelper.dumps()).toBe(0);
	});

	test("without the helper, the Screen comes from uiautomator dump and the session says so", async () => {
		const { session, dumps } = await open(async () => {
			throw new Error("yoqa.android.devtools is not installed");
		});

		expect(await elements(session)).toEqual(await elements((await open()).session));
		expect(dumps()).toBe(1);
		expect(session.laneWarning).toMatch(/uiautomator dump.*not installed/);
	});

	test("a helper that fails mid-session is stopped, and the tree falls back to uiautomator dump", async () => {
		const helper = fakeHelper();
		const { session, dumps } = await open(async () => helper);
		await elements(session);
		helper.failTree = true;

		const fromDump = await elements(session);
		await elements(session);

		expect(fromDump?.map((element) => element.label)).toEqual(["Allow", "Name"]);
		expect(helper.stops).toBe(1);
		expect(dumps()).toBe(2);
		expect(session.laneWarning).toMatch(/uiautomator dump.*connection reset/);
	});

	test("quit stops the helper once", async () => {
		const helper = fakeHelper();
		const { session } = await open(async () => helper);
		await session.quit();
		await session.quit();
		expect(helper.stops).toBe(1);
	});

	test("bounds use the display size the helper reports, as a dump of a rotated screen does", async () => {
		const landscape = { width: 2400, height: 1080 };
		const node: DevtoolsNode = {
			role: "android.widget.Button",
			value: "Play",
			bounds: { x: 0.5, y: 0.5, width: 0.25, height: 0.25 },
			enabled: true,
		};
		const { session } = await open(async () => fakeHelper([node], landscape));
		expect(await session.pageSource()).toContain('bounds="[1200,540][1800,810]"');
	});

	test("a helper left running by a crashed runner doesn't break uiautomator dump", async () => {
		const { session } = await open(undefined, { helperLeftRunning: true });
		expect((await elements(session))?.map((element) => element.label)).toEqual(["Allow", "Name"]);
	});
});
