import { describe, expect, test } from "bun:test";
import { snapshotNodesToScreen } from "./screen";
import type { SnapshotNode } from "./session";

const WINDOW = { width: 402, height: 874 };

function node(partial: Partial<SnapshotNode> & { ref: string }): SnapshotNode {
	return partial;
}

describe("snapshotNodesToScreen", () => {
	test("normalizes rects to 0–1000 and keeps labeled nodes", () => {
		const screen = snapshotNodesToScreen(
			[
				node({
					ref: "e1",
					role: "button",
					label: "Login",
					identifier: "com.app:id/login",
					rect: { x: 40.2, y: 87.4, width: 80.4, height: 34.96 },
					enabled: true,
				}),
				node({ ref: "e2", role: "window", rect: { x: 0, y: 0, width: 402, height: 874 } }),
			],
			WINDOW,
		);
		expect(screen.window).toEqual(WINDOW);
		expect(screen.elements).toHaveLength(1);
		expect(screen.elements[0]).toMatchObject({
			type: "button",
			label: "Login",
			id: "com.app:id/login",
			x: 100,
			y: 100,
			width: 200,
			height: 40,
			enabled: true,
		});
	});

	test("drops zero-size and offscreen nodes", () => {
		const screen = snapshotNodesToScreen(
			[
				node({ ref: "e1", role: "text", label: "zero", rect: { x: 0, y: 0, width: 0, height: 0 } }),
				node({
					ref: "e2",
					role: "text",
					label: "offscreen",
					rect: { x: 2000, y: 0, width: 100, height: 50 },
				}),
				node({
					ref: "e3",
					role: "text",
					label: "Visible",
					rect: { x: 20, y: 40, width: 100, height: 24 },
				}),
			],
			WINDOW,
		);
		expect(screen.elements).toHaveLength(1);
		expect(screen.elements[0]?.label).toBe("Visible");
	});

	test("does not treat deeplinks as ids or labels", () => {
		const screen = snapshotNodesToScreen(
			[
				node({
					ref: "e1",
					type: "Cell",
					identifier: "cashgiraffeSB://game-details/6751056655",
					rect: { x: 0, y: 100, width: 390, height: 80 },
				}),
				node({
					ref: "e2",
					type: "Link",
					label: "Open game",
					identifier: "https://example.com/game",
					rect: { x: 10, y: 200, width: 100, height: 40 },
				}),
			],
			{ width: 390, height: 844 },
		);
		expect(screen.elements).toHaveLength(2);
		expect(screen.elements[0]).toMatchObject({ label: "" });
		expect(screen.elements[0]?.id).toBeUndefined();
		expect(screen.elements[1]).toMatchObject({ label: "Open game" });
		expect(screen.elements[1]?.id).toBeUndefined();
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
