import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanPageSource } from "./screen";

const WINDOW = { width: 1000, height: 2000 };

describe("cleanPageSource", () => {
	test("normalizes Android bounds to 0–1000 and keeps labeled nodes", () => {
		const xml = `
<hierarchy>
  <android.widget.FrameLayout bounds="[0,0][1000,2000]" />
  <android.widget.Button bounds="[100,200][300,280]" text="Login" resource-id="com.app:id/login" enabled="true" />
  <android.widget.TextView bounds="[0,0][0,0]" text="zero" />
  <android.widget.TextView bounds="[2000,0][2100,50]" text="offscreen" />
</hierarchy>
`;
		const cleaned = cleanPageSource(xml, WINDOW);
		expect(cleaned.window).toEqual(WINDOW);
		expect(cleaned.elements).toHaveLength(1);
		expect(cleaned.elements[0]).toMatchObject({
			type: "android.widget.Button",
			label: "Login",
			id: "com.app:id/login",
			x: 100,
			y: 100,
			width: 200,
			height: 40,
			enabled: true,
		});
	});

	test("parses iOS frames and drops invisible nodes", () => {
		const xml = `
<XCUIElementTypeApplication x="0" y="0" width="390" height="844">
  <XCUIElementTypeButton x="39" y="84.4" width="78" height="42.2" label="Continue" name="continue_btn" visible="true" />
  <XCUIElementTypeStaticText x="10" y="10" width="50" height="20" label="Hidden" visible="false" />
  <XCUIElementTypeOther x="0" y="0" width="390" height="844" />
</XCUIElementTypeApplication>
`;
		const cleaned = cleanPageSource(xml, { width: 390, height: 844 });
		expect(cleaned.elements).toHaveLength(1);
		expect(cleaned.elements[0]).toMatchObject({
			type: "XCUIElementTypeButton",
			label: "Continue",
			id: "continue_btn",
			x: 100,
			y: 100,
			width: 200,
			height: 50,
			visible: true,
		});
	});

	test("does not treat deeplink name as id or label", () => {
		const xml = `
<XCUIElementTypeApplication x="0" y="0" width="390" height="844">
  <XCUIElementTypeCell x="0" y="100" width="390" height="80" name="cashgiraffeSB://game-details/6751056655" visible="true" />
  <XCUIElementTypeLink x="10" y="200" width="100" height="40" label="Open game" name="https://example.com/game" visible="true" />
</XCUIElementTypeApplication>
`;
		const cleaned = cleanPageSource(xml, { width: 390, height: 844 });
		expect(cleaned.elements).toHaveLength(2);

		const cell = cleaned.elements[0];
		expect(cell).toMatchObject({
			type: "XCUIElementTypeCell",
			label: "",
		});
		expect(cell?.id).toBeUndefined();

		const link = cleaned.elements[1];
		expect(link).toMatchObject({
			type: "XCUIElementTypeLink",
			label: "Open game",
		});
		expect(link?.id).toBeUndefined();
	});

	test("drops unlabeled iOS scroll/table containers and never uses type as label", () => {
		const xml = `
<XCUIElementTypeApplication x="0" y="0" width="390" height="844">
  <XCUIElementTypeScrollView x="0" y="0" width="390" height="844" visible="true" />
  <XCUIElementTypeCollectionView x="0" y="0" width="390" height="400" visible="true" />
  <XCUIElementTypeTable x="0" y="400" width="390" height="400" visible="true" />
  <XCUIElementTypeWebView x="0" y="0" width="390" height="844" visible="true" />
  <XCUIElementTypeStaticText x="20" y="40" width="100" height="24" label="Discover" visible="true" />
</XCUIElementTypeApplication>
`;
		const cleaned = cleanPageSource(xml, { width: 390, height: 844 });
		expect(cleaned.elements).toHaveLength(1);
		expect(cleaned.elements[0]).toMatchObject({
			type: "XCUIElementTypeStaticText",
			label: "Discover",
		});
		expect(cleaned.elements.every((el) => el.label !== el.type)).toBe(true);
	});

	test("keeps system dialogs from a uiautomator <node> dump", () => {
		const xml = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node bounds="[28,979][1052,1485]" class="android.widget.FrameLayout" package="android" text="" />
  <node bounds="[133,1068][947,1131]" class="android.widget.TextView" package="android" resource-id="android:id/alertTitle" text="Pixel Launcher isn't responding" />
  <node bounds="[70,1170][1010,1296]" class="android.widget.Button" package="android" resource-id="android:id/aerr_close" text="Close app" clickable="true" enabled="true" />
  <node bounds="[70,1296][1010,1422]" class="android.widget.Button" package="android" resource-id="android:id/aerr_wait" text="Wait" clickable="true" enabled="true" />
</hierarchy>`;
		const cleaned = cleanPageSource(xml, { width: 1080, height: 2400 });
		const labels = cleaned.elements.map((el) => el.label);
		expect(labels).toContain("Pixel Launcher isn't responding");
		expect(labels).toContain("Close app");
		expect(labels).toContain("Wait");
		expect(cleaned.elements.find((el) => el.label === "Wait")).toMatchObject({
			type: "android.widget.Button",
			id: "android:id/aerr_wait",
		});
	});

	test("keeps an idb system modal and axbridge buttons on the Screen", () => {
		const complete = JSON.stringify({
			backend: "axbridge-exclusive",
			modal: {
				kind: "system",
				element_type: "_UIAlertControllerPhoneTVMacView",
				label: "Allow “Maps” to use your location?",
			},
			elements: [
				{
					type: "Other",
					label: "Maps",
					frame: { x: 0, y: 0, width: 402, height: 874 },
					children: [
						{
							type: "Button",
							label: "Allow While Using App",
							frame: { x: 24, y: 420, width: 354, height: 44 },
							enabled: true,
						},
						{
							type: "Button",
							label: "Don’t Allow",
							frame: { x: 24, y: 470, width: 354, height: 44 },
							enabled: true,
						},
					],
				},
			],
		});
		const cleaned = cleanPageSource(complete, { width: 402, height: 874 });
		const labels = cleaned.elements.map((el) => el.label);
		expect(labels).toContain("Allow “Maps” to use your location?");
		expect(labels).toContain("Allow While Using App");
		expect(labels).toContain("Don’t Allow");
		expect(cleaned.elements.find((el) => el.label === "Allow While Using App")).toMatchObject({
			type: "Button",
		});
	});

	test("decodes XML entities in Android text and iOS label", () => {
		const android = cleanPageSource(
			`
<hierarchy>
  <android.widget.TextView bounds="[100,200][400,280]" text="Help &amp; Info" enabled="true" />
</hierarchy>
`,
			WINDOW,
		);
		expect(android.elements).toHaveLength(1);
		expect(android.elements[0]?.label).toBe("Help & Info");

		const ios = cleanPageSource(
			`
<XCUIElementTypeApplication x="0" y="0" width="390" height="844">
  <XCUIElementTypeStaticText x="39" y="84.4" width="78" height="42.2" label="Help &amp; Info" visible="true" />
</XCUIElementTypeApplication>
`,
			{ width: 390, height: 844 },
		);
		expect(ios.elements).toHaveLength(1);
		expect(ios.elements[0]?.label).toBe("Help & Info");
	});
});

describe("cleanPageSource on a web page's accessibility tree", () => {
	/** A sign-in page as the web Direct lane reads it: CDP's full AX tree, each node with its box. */
	const SIGN_IN = readFileSync(join(import.meta.dir, "fixtures", "web-ax-sign-in.json"), "utf8");
	const VIEWPORT = { width: 1280, height: 800 };

	test("keeps the page's controls and text, in the mobile node shape on 0–1000", () => {
		const cleaned = cleanPageSource(SIGN_IN, VIEWPORT);
		expect(cleaned.window).toEqual(VIEWPORT);
		expect(cleaned.elements).toEqual([
			{
				type: "heading",
				label: "Welcome back",
				x: 50,
				y: 50,
				width: 500,
				height: 60,
				enabled: true,
			},
			{
				type: "textbox",
				label: "Email",
				id: "email",
				x: 50,
				y: 150,
				width: 500,
				height: 50,
				enabled: true,
			},
			{ type: "textbox", label: "Password", x: 50, y: 220, width: 500, height: 50, enabled: true },
			{
				type: "button",
				label: "Sign in",
				id: "sign-in-button",
				x: 50,
				y: 300,
				width: 100,
				height: 50,
				enabled: true,
			},
			{
				type: "link",
				label: "Forgot password?",
				x: 50,
				y: 370,
				width: 100,
				height: 20,
				enabled: true,
			},
			{
				type: "button",
				label: "Use a passkey",
				x: 175,
				y: 300,
				width: 125,
				height: 50,
				enabled: false,
			},
			{
				type: "button",
				label: "",
				id: "close",
				x: 950,
				y: 20,
				width: 38,
				height: 60,
				enabled: true,
			},
			{
				type: "StaticText",
				label: "By signing in you agree to the terms.",
				x: 50,
				y: 500,
				width: 313,
				height: 25,
				enabled: true,
			},
		]);
	});

	test("drops hidden, zero-size, offscreen and purely structural nodes", () => {
		const labels = cleanPageSource(SIGN_IN, VIEWPORT).elements.map((el) => el.label);
		expect(labels).not.toContain("Sign in – Acme");
		expect(labels).not.toContain("Collapsed");
		expect(labels).not.toContain("Below the fold");
		const types = cleanPageSource(SIGN_IN, VIEWPORT).elements.map((el) => el.type);
		for (const noise of ["RootWebArea", "generic", "InlineTextBox", "paragraph", "image", "none"]) {
			expect(types).not.toContain(noise);
		}
	});

	test("names a control once: the text inside a button or link is not a second node", () => {
		const labels = cleanPageSource(SIGN_IN, VIEWPORT).elements.map((el) => el.label);
		expect(labels.filter((label) => label === "Sign in")).toHaveLength(1);
		expect(labels.filter((label) => label === "Forgot password?")).toHaveLength(1);
		expect(labels.filter((label) => label === "Welcome back")).toHaveLength(1);
	});

	test("is a fraction of the raw tree it was cleaned from", () => {
		const cleaned = JSON.stringify(cleanPageSource(SIGN_IN, VIEWPORT).elements);
		expect(cleaned.length).toBeLessThan(JSON.stringify(JSON.parse(SIGN_IN)).length / 4);
	});

	test("an empty page is an empty Screen", () => {
		expect(cleanPageSource(JSON.stringify({ axTree: [] }), VIEWPORT).elements).toEqual([]);
	});

	/** A page's AX tree from `[nodeId, parentId, role, name, extras]` rows, every node laid out. */
	const page = (
		rows: Array<[string, string | undefined, string, string, Record<string, unknown>?]>,
	): string =>
		JSON.stringify({
			axTree: rows.map(([nodeId, parentId, role, name, extras]) => ({
				nodeId,
				ignored: false,
				role: { type: "role", value: role },
				name: { type: "computedString", value: name },
				...(parentId ? { parentId } : {}),
				bounds: { x: 64, y: 64, width: 128, height: 32 },
				...extras,
			})),
		});

	test("drops text inside a control even when it differs from the control's name", () => {
		const source = page([
			["1", undefined, "RootWebArea", "Settings"],
			["2", "1", "button", "Switch color theme", { domId: "theme" }],
			["3", "2", "generic", ""],
			["4", "3", "StaticText", "Theme"],
			["5", "1", "link", "Read the docs"],
			["6", "5", "StaticText", "read the DOCS"],
		]);
		expect(cleanPageSource(source, VIEWPORT).elements.map((el) => [el.type, el.label])).toEqual([
			["button", "Switch color theme"],
			["link", "Read the docs"],
		]);
	});

	test("keeps text that is not inside a control, and text whose control is off the Screen", () => {
		const source = page([
			["1", undefined, "RootWebArea", "Settings"],
			["2", "1", "paragraph", ""],
			["3", "2", "StaticText", "Theme"],
			["4", "1", "button", "Open", { bounds: { x: 64, y: 64, width: 0, height: 0 } }],
			["5", "4", "StaticText", "Open the menu"],
		]);
		expect(cleanPageSource(source, VIEWPORT).elements.map((el) => [el.type, el.label])).toEqual([
			["StaticText", "Theme"],
			["StaticText", "Open the menu"],
		]);
	});

	test("keeps an unnamed image that has a data-testid or DOM id, so it can be tapped by id", () => {
		const source = page([
			["1", undefined, "RootWebArea", "Profile"],
			["2", "1", "img", "", { testId: "avatar" }],
			["3", "1", "image", "", { domId: "banner" }],
			["4", "1", "image", ""],
			["5", "1", "image", "", { domId: ":r1:" }],
			["6", "1", "generic", "", { testId: "wrapper" }],
		]);
		expect(cleanPageSource(source, VIEWPORT).elements.map((el) => [el.type, el.id])).toEqual([
			["img", "avatar"],
			["image", "banner"],
		]);
	});

	test("keeps aria-hidden content out, id'd images and text included", () => {
		const hidden = { ignored: true, ignoredReasons: [{ name: "ariaHiddenSubtree" }] };
		const source = page([
			["1", undefined, "RootWebArea", "Profile"],
			["2", "1", "generic", "", hidden],
			["3", "2", "image", "", { ...hidden, testId: "decoration" }],
			["4", "2", "StaticText", "Decorative", hidden],
		]);
		expect(cleanPageSource(source, VIEWPORT).elements).toEqual([]);
	});
});
