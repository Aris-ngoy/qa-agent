import { describe, expect, test } from "bun:test";
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
});
