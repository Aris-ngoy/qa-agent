import { describe, expect, test } from "bun:test";
import { extractAgentJsonObject } from "../providers/agent-json";
import {
	coerceScrollIntentToSwipe,
	continueScrollingInsteadOfComplete,
	decisionToActionRequest,
	flattenCaseInstructions,
	formatDecidePrompt,
	formatScreenSnapshot,
	isScrollUntilEndGoal,
	isSystemPermissionLabel,
	parseAgentDecision,
	prefersScreenshotTap,
	resolveSwipeNorm,
	splitInstructionSteps,
} from "./agent";

describe("parseAgentDecision", () => {
	test("clamps a tap whose y overshoots the 0–1000 grid", () => {
		const raw = extractAgentJsonObject(
			'{"type":"tap","x":270,"y":1006,"reason":"Need to get past onboarding screen first before accessing games","thoughts":"The screen shows an onboarding/welcome screen"}',
			"Model",
		);
		expect(parseAgentDecision(raw)).toMatchObject({
			type: "tap",
			x: 270,
			y: 1000,
			reason: "Need to get past onboarding screen first before accessing games",
		});
	});

	test("parses a directional swipe and clamps swipe endpoints", () => {
		expect(
			parseAgentDecision(
				extractAgentJsonObject(
					'{"type":"swipe","direction":"up","reason":"Scroll to the bottom","thoughts":"A feed is visible and more content is below"}',
					"Model",
				),
			),
		).toMatchObject({
			type: "swipe",
			direction: "up",
			reason: "Scroll to the bottom",
		});

		expect(
			parseAgentDecision(
				extractAgentJsonObject(
					'{"type":"swipe","x":500,"y":800,"x2":500,"y2":1006,"reason":"Scroll down","thoughts":"List continues below"}',
					"Model",
				),
			),
		).toMatchObject({
			type: "swipe",
			x: 500,
			y: 800,
			x2: 500,
			y2: 1000,
		});
	});

	test("salvages truncated thoughts and still returns a tap", () => {
		const raw = extractAgentJsonObject(
			'{"type":"tap","x":270,"y":1006,"reason":"Need to get past onboarding screen first before accessing games","thoughts":"The screen shows an onboarding/welcome scr',
			"Model",
		);
		const decision = parseAgentDecision(raw);
		expect(decision.type).toBe("tap");
		expect(decision.x).toBe(270);
		expect(decision.y).toBe(1000);
		expect(decision.thoughts.startsWith("The screen shows an onboarding")).toBe(true);
	});

	test("parses a label tap and an accept-alert action", () => {
		expect(
			parseAgentDecision(
				extractAgentJsonObject(
					'{"type":"tap","label":"Allow","reason":"Grant notifications","thoughts":"Permission dialog is visible with Allow"}',
					"Model",
				),
			),
		).toMatchObject({
			type: "tap",
			label: "Allow",
			reason: "Grant notifications",
		});

		expect(
			parseAgentDecision(
				extractAgentJsonObject(
					'{"type":"alert","alertAction":"accept","reason":"Accept the permission","thoughts":"System Allow dialog is on screen"}',
					"Model",
				),
			),
		).toMatchObject({
			type: "alert",
			alertAction: "accept",
		});
	});
});

describe("prefersScreenshotTap", () => {
	test("in-app coords win even when a label is also present", () => {
		expect(prefersScreenshotTap({ x: 120, y: 340, label: "Login" })).toBe(true);
		expect(prefersScreenshotTap({ x: 120, y: 340 })).toBe(true);
	});

	test("permission labels keep locator taps", () => {
		expect(isSystemPermissionLabel("Allow")).toBe(true);
		expect(isSystemPermissionLabel("Don't allow")).toBe(true);
		expect(prefersScreenshotTap({ x: 269, y: 951, label: "Allow" })).toBe(false);
		expect(prefersScreenshotTap({ label: "Allow" })).toBe(false);
	});

	test("tree id wins over screenshot coordinates", () => {
		expect(prefersScreenshotTap({ x: 120, y: 340, id: "login_btn" })).toBe(false);
	});
});

describe("resolveSwipeNorm", () => {
	test("expands finger direction to Inspector swipe coords", () => {
		expect(resolveSwipeNorm({ direction: "up" })).toEqual({ x: 500, y: 800, x2: 500, y2: 200 });
		expect(resolveSwipeNorm({ direction: "down" })).toEqual({ x: 500, y: 200, x2: 500, y2: 800 });
	});

	test("prefers explicit endpoints over direction", () => {
		expect(resolveSwipeNorm({ direction: "up", x: 400, y: 700, x2: 400, y2: 250 })).toEqual({
			x: 400,
			y: 700,
			x2: 400,
			y2: 250,
		});
	});
});

describe("coerceScrollIntentToSwipe", () => {
	test("rewrites a bottom-of-screen tap whose reason is scroll down", () => {
		expect(
			coerceScrollIntentToSwipe({
				type: "tap",
				x: 270,
				y: 900,
				reason: "Scroll down to reach the bottom of the page",
				thoughts: "I see Discover and need to scroll down further where scrolling stops.",
			}),
		).toMatchObject({ type: "swipe", direction: "up" });
	});

	test("rewrites a wait that admits tapping does not scroll", () => {
		expect(
			coerceScrollIntentToSwipe({
				type: "wait",
				ms: 800,
				reason: "Need to check if page scrolls further before confirming bottom",
				thoughts: "Need to scroll down more since tap action doesn't scroll.",
			}),
		).toMatchObject({ type: "swipe", direction: "up" });
	});

	test("leaves ordinary taps and permission taps alone", () => {
		expect(
			coerceScrollIntentToSwipe({
				type: "tap",
				x: 120,
				y: 340,
				reason: "Open login",
				thoughts: "Login button is visible",
			}).type,
		).toBe("tap");
		expect(
			coerceScrollIntentToSwipe({
				type: "tap",
				label: "Allow",
				x: 500,
				y: 900,
				reason: "Grant notifications so the feed can scroll",
				thoughts: "Permission dialog is blocking the scrollable list",
			}),
		).toMatchObject({ type: "tap", label: "Allow" });
	});
});

describe("continueScrollingInsteadOfComplete", () => {
	test("blocks verify when the case is scroll-until-end and no swipe has run", () => {
		expect(
			continueScrollingInsteadOfComplete({
				decision: {
					type: "verify",
					reason: "The screen has remained unchanged after multiple scroll attempts",
					thoughts:
						"Taps at (270,900) did not change the four visible games, so this is the bottom.",
				},
				instructions: "Scroll down until you can not scroll anymore",
				expectedResult:
					"should scroll right at the bottom where it should not be able to scroll again",
				recentActions: [
					{
						type: "tap",
						x: 270,
						y: 900,
						reason: "Scroll down",
						thoughts: "List may continue below",
					},
				],
				lastSwipeMovedScreen: false,
			}),
		).toMatchObject({ type: "swipe", direction: "up" });
	});

	test("keeps swiping while the last swipe still moved the screenshot", () => {
		expect(
			continueScrollingInsteadOfComplete({
				decision: {
					type: "done",
					reason: "Reached the bottom",
					thoughts: "List looks done",
				},
				instructions: "Scroll down until you can not scroll anymore",
				expectedResult: "The list cannot scroll further",
				recentActions: [
					{
						type: "swipe",
						direction: "up",
						reason: "Scroll down",
						thoughts: "More content below",
					},
				],
				lastSwipeMovedScreen: true,
			}),
		).toMatchObject({ type: "swipe", direction: "up" });
	});

	test("allows verify after a swipe that left the screenshot unchanged", () => {
		expect(
			continueScrollingInsteadOfComplete({
				decision: {
					type: "verify",
					reason: "Cannot scroll further",
					thoughts: "Same games after the last swipe",
				},
				instructions: "Scroll down until you can not scroll anymore",
				expectedResult: "The list cannot scroll further",
				recentActions: [
					{
						type: "swipe",
						direction: "up",
						reason: "Scroll down",
						thoughts: "More content below",
					},
				],
				lastSwipeMovedScreen: false,
			}).type,
		).toBe("verify");
	});
});

describe("isScrollUntilEndGoal", () => {
	test("matches the catalog scroll-until-bottom wording", () => {
		expect(
			isScrollUntilEndGoal(
				"Scroll down until you can not scroll anymore",
				"should scroll right at the bottom where it should not be able to scroll again",
			),
		).toBe(true);
		expect(isScrollUntilEndGoal("Tap Login", "Home is visible")).toBe(false);
	});
});

describe("formatScreenSnapshot", () => {
	test("prints id and label on the 0–1000 grid", () => {
		expect(
			formatScreenSnapshot([
				{
					type: "Button",
					label: "Login",
					id: "login_btn",
					x: 400,
					y: 880,
					width: 200,
					height: 60,
				},
			]),
		).toContain("id=login_btn");
		expect(formatScreenSnapshot([])).toBe("(empty tree)");
		expect(formatScreenSnapshot(undefined)).toBe("(screen tree unavailable)");
	});
});

describe("decisionToActionRequest", () => {
	test("maps CLI-parity actions onto ActionRequest", () => {
		expect(
			decisionToActionRequest({
				type: "tap",
				id: "login_btn",
				x: 120,
				y: 340,
				reason: "Tap login",
				thoughts: "Id is in the tree",
			}),
		).toEqual({ kind: "tap", id: "login_btn" });

		expect(
			decisionToActionRequest({
				type: "drag",
				x: 100,
				y: 500,
				x2: 800,
				y2: 500,
				reason: "Move slider",
				thoughts: "Slider handle",
			}),
		).toMatchObject({ kind: "drag", x: 100, y: 500, x2: 800, y2: 500 });

		expect(
			decisionToActionRequest(
				{
					type: "restart-app",
					reason: "Cold start",
					thoughts: "Need a fresh launch",
				},
				{ defaultAppId: "com.example.app" },
			),
		).toEqual({ kind: "restart-app", appId: "com.example.app" });

		expect(
			decisionToActionRequest({
				type: "open-url",
				url: "myapp://home",
				reason: "Deeplink home",
				thoughts: "Skip onboarding",
			}),
		).toEqual({ kind: "open-url", url: "myapp://home" });

		expect(
			decisionToActionRequest({
				type: "assert",
				assertion: "visible",
				text: "Welcome",
				reason: "Check copy",
				thoughts: "Title visible",
			}),
		).toBeNull();
	});

	test("parses drag and open-url decisions", () => {
		expect(
			parseAgentDecision(
				extractAgentJsonObject(
					'{"type":"open-url","url":"https://example.com","reason":"Open help","thoughts":"Need the help page"}',
					"Model",
				),
			),
		).toMatchObject({ type: "open-url", url: "https://example.com" });
	});
});

describe("splitInstructionSteps", () => {
	test("keeps a single paragraph as one instruction", () => {
		expect(splitInstructionSteps("Tap on paypal pick any amount")).toEqual([
			"Tap on paypal pick any amount",
		]);
	});

	test("splits a numbered list into one action per item", () => {
		expect(
			splitInstructionSteps(
				'1. Open the Settings screen.\n2. Toggle "Dark mode" on.\n3. Return to the Home screen.',
			),
		).toEqual([
			"Open the Settings screen.",
			'Toggle "Dark mode" on.',
			"Return to the Home screen.",
		]);
	});

	test("keeps a wrapped numbered item as one step", () => {
		expect(
			splitInstructionSteps("1. Open Settings then\n   find Dark mode.\n2. Toggle it on."),
		).toEqual(["Open Settings then find Dark mode.", "Toggle it on."]);
	});
});

describe("flattenCaseInstructions", () => {
	test("queues each catalog flow and only attaches expectedResult to the last numbered step", () => {
		expect(
			flattenCaseInstructions([
				{
					instructions: "1. Navigate to Rewards\n2. Tap on paypal pick any amount",
					expectedResult: "should see the payout detail screen",
				},
				{
					instructions: "Tap on confirm to complete the payout",
					expectedResult: "should see Payout Success",
				},
			]),
		).toEqual([
			{ instructions: "Navigate to Rewards", expectedResult: "" },
			{
				instructions: "Tap on paypal pick any amount",
				expectedResult: "should see the payout detail screen",
			},
			{
				instructions: "Tap on confirm to complete the payout",
				expectedResult: "should see Payout Success",
			},
		]);
	});
});

describe("formatDecidePrompt", () => {
	test("sends only the current instruction and hides later ones", () => {
		const prompt = formatDecidePrompt({
			appContext: "Cash Giraffe",
			caseTitle: "Payout",
			instructions: "Tap on paypal pick any amount",
			expectedResult: "should see the payout detail screen",
			stepIndex: 3,
			instructionOrdinal: 2,
			instructionCount: 20,
			completedInstructions: ["Navigate to Rewards"],
			screenSnapshot: "(empty tree)",
		});
		expect(prompt).toContain("Instruction 2 of 20");
		expect(prompt).toContain("Current instruction (do ONLY this): Tap on paypal pick any amount");
		expect(prompt).toContain("1. Navigate to Rewards");
		expect(prompt).toContain("Later instructions exist (18) but are hidden");
		expect(prompt).not.toContain("Tap on confirm");
		expect(prompt).not.toContain("Hello Fresh");
	});
});
