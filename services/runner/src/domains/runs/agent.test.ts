import { describe, expect, test } from "bun:test";
import { extractAgentJsonObject } from "../providers/agent-json";
import {
	SYSTEM_PROMPT,
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

	test("validates a prompt-JSON tap with reason and thoughts preserved", () => {
		const decision = parseAgentDecision(
			extractAgentJsonObject(
				'{"type":"tap","x":420,"y":780,"reason":"Open the product","thoughts":"The catalog shows a product card and tapping it opens the detail screen."}',
				"Groq",
			),
		);
		expect(decision).toMatchObject({
			type: "tap",
			x: 420,
			y: 780,
			reason: "Open the product",
			thoughts: "The catalog shows a product card and tapping it opens the detail screen.",
		});
	});

	test("validates a prompt-JSON wait with pause duration", () => {
		const decision = parseAgentDecision(
			extractAgentJsonObject(
				'{"type":"wait","ms":2000,"reason":"Let the splash settle","thoughts":"A splash logo is visible and the home screen has not loaded yet."}',
				"Groq",
			),
		);
		expect(decision).toMatchObject({
			type: "wait",
			ms: 2000,
			reason: "Let the splash settle",
		});
	});

	test("salvages fenced single-quoted prompt JSON", () => {
		const decision = parseAgentDecision(
			extractAgentJsonObject(
				"Here you go:\n```json\n{'type':'tap','x':120,'y':340,'reason':'Tap the login button','thoughts':'The login form is visible with the button enabled.'}\n```",
				"Groq",
			),
		);
		expect(decision).toMatchObject({
			type: "tap",
			x: 120,
			y: 340,
			reason: "Tap the login button",
		});
	});

	test("salvages a lightly truncated prompt-JSON wait", () => {
		const decision = parseAgentDecision(
			extractAgentJsonObject(
				'{"type":"wait","ms":1500,"reason":"Splash is loading","thoughts":"The splash logo is still visi',
				"Groq",
			),
		);
		expect(decision.type).toBe("wait");
		expect(decision).toMatchObject({ ms: 1500, reason: "Splash is loading" });
	});

	test("rejects an unrecoverable reply as not-a-valid-action with path detail", () => {
		expect(() =>
			parseAgentDecision(extractAgentJsonObject('{"type":"tap","x":100,"y":200}', "Groq")),
		).toThrow(/not a valid action.*reason/);
	});
});

describe("Groq Action-family parity (#140)", () => {
	function groqDecision(json: string) {
		return parseAgentDecision(extractAgentJsonObject(json, "Groq"));
	}

	test("swipe accepts finger direction or four coordinates", () => {
		expect(
			groqDecision(
				'{"type":"swipe","direction":"up","reason":"Scroll down","thoughts":"A feed is visible and more content sits below the fold."}',
			),
		).toMatchObject({ type: "swipe", direction: "up", reason: "Scroll down" });
		expect(
			groqDecision(
				'{"type":"swipe","x":500,"y":800,"x2":500,"y2":200,"reason":"Scroll down","thoughts":"List continues below the visible rows."}',
			),
		).toMatchObject({ type: "swipe", x: 500, y: 800, x2: 500, y2: 200 });
		expect(() =>
			groqDecision(
				'{"type":"swipe","reason":"Scroll","thoughts":"List may continue but no direction or coordinates were given."}',
			),
		).toThrow(/not a valid action.*swipe requires direction/);
	});

	test("drag requires four coordinates", () => {
		expect(
			groqDecision(
				'{"type":"drag","x":100,"y":500,"x2":800,"y2":500,"reason":"Move slider","thoughts":"Slider handle is at the left and the track extends right."}',
			),
		).toMatchObject({ type: "drag", x: 100, y: 500, x2: 800, y2: 500 });
		expect(() =>
			groqDecision(
				'{"type":"drag","x":100,"y":500,"reason":"Move slider","thoughts":"Slider is visible but the drop point is missing."}',
			),
		).toThrow(/not a valid action.*drag requires x,y,x2,y2/);
	});

	test("type/input require text", () => {
		expect(
			groqDecision(
				'{"type":"type","text":"hello","reason":"Fill search","thoughts":"Search field is focused and empty."}',
			),
		).toMatchObject({ type: "type", text: "hello" });
		expect(
			groqDecision(
				'{"type":"input","text":"user@example.com","id":"email_field","reason":"Fill email","thoughts":"Login form shows an empty email field."}',
			),
		).toMatchObject({ type: "input", text: "user@example.com" });
		expect(() =>
			groqDecision(
				'{"type":"type","reason":"Fill search","thoughts":"Search field is focused but no text was provided."}',
			),
		).toThrow(/not a valid action.*type\/input requires text/);
		expect(() =>
			groqDecision(
				'{"type":"input","text":"   ","reason":"Fill email","thoughts":"Field is empty and blank text was given."}',
			),
		).toThrow(/not a valid action.*type\/input requires text/);
	});

	test("open-url requires URL", () => {
		expect(
			groqDecision(
				'{"type":"open-url","url":"https://example.com","reason":"Open help","thoughts":"Help link is needed to finish this instruction."}',
			),
		).toMatchObject({ type: "open-url", url: "https://example.com" });
		expect(() =>
			groqDecision(
				'{"type":"open-url","reason":"Open help","thoughts":"Navigation was requested but no URL was provided."}',
			),
		).toThrow(/not a valid action.*open-url requires url/);
	});

	test("assert requires text", () => {
		expect(
			groqDecision(
				'{"type":"assert","assertion":"visible","text":"Welcome","reason":"Check copy","thoughts":"Home title should read Welcome after login."}',
			),
		).toMatchObject({ type: "assert", assertion: "visible", text: "Welcome" });
		expect(
			groqDecision(
				'{"type":"assert","assertion":"not-visible","text":"Loading","reason":"Check spinner gone","thoughts":"Spinner should be gone once content loads."}',
			),
		).toMatchObject({ type: "assert", assertion: "not-visible", text: "Loading" });
		expect(() =>
			groqDecision(
				'{"type":"assert","assertion":"visible","reason":"Check copy","thoughts":"Title check was requested but no text was given."}',
			),
		).toThrow(/not a valid action.*assert requires text/);
	});

	test("alert accepts accept/dismiss", () => {
		expect(
			groqDecision(
				'{"type":"alert","alertAction":"accept","reason":"Accept permission","thoughts":"System Allow dialog is on screen."}',
			),
		).toMatchObject({ type: "alert", alertAction: "accept" });
		expect(
			groqDecision(
				'{"type":"alert","alertAction":"dismiss","reason":"Dismiss dialog","thoughts":"Permission dialog blocks the form and should be dismissed."}',
			),
		).toMatchObject({ type: "alert", alertAction: "dismiss" });
	});

	test("app-lifecycle carries application id", () => {
		expect(
			groqDecision(
				'{"type":"activate-app","appId":"com.example.app","reason":"Foreground app","thoughts":"App is backgrounded and the case needs it open."}',
			),
		).toMatchObject({ type: "activate-app", appId: "com.example.app" });
		expect(
			groqDecision(
				'{"type":"terminate-app","appId":"com.example.app","reason":"Cold start","thoughts":"App state is stale and needs a fresh launch."}',
			),
		).toMatchObject({ type: "terminate-app", appId: "com.example.app" });
		expect(
			groqDecision(
				'{"type":"restart-app","appId":"com.example.app","reason":"Restart","thoughts":"Restart clears the stuck splash screen."}',
			),
		).toMatchObject({ type: "restart-app", appId: "com.example.app" });
		expect(
			groqDecision(
				'{"type":"background-app","seconds":3,"reason":"Background briefly","thoughts":"Case needs the app backgrounded for three seconds."}',
			),
		).toMatchObject({ type: "background-app", seconds: 3 });
	});

	test("verify/done/fail validate with reason and thoughts", () => {
		for (const type of ["verify", "done", "fail"] as const) {
			expect(
				groqDecision(
					`{"type":"${type}","reason":"Step complete","thoughts":"Expected result is visible on screen now."}`,
				),
			).toMatchObject({ type, reason: "Step complete" });
		}
	});

	test("every decision requires non-empty reason and thoughts", () => {
		expect(() => groqDecision('{"type":"tap","x":100,"y":200}')).toThrow(/not a valid action/);
		expect(() => groqDecision('{"type":"tap","x":100,"y":200,"reason":"","thoughts":""}')).toThrow(
			/not a valid action/,
		);
		const decision = groqDecision(
			'{"type":"tap","x":100,"y":200,"reason":"Tap login","thoughts":"Login button is visible and enabled."}',
		);
		expect(decision.reason.trim().length).toBeGreaterThan(0);
		expect(decision.thoughts.trim().length).toBeGreaterThan(0);
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
		expect(prompt).toContain(
			"Decide whether to use x,y coordinates or an id based on both sources.",
		);
	});

	test("injects app knowledge when present and omits the section when absent", () => {
		const base = {
			appContext: "Playzone",
			caseTitle: "Check Navigation",
			instructions: "Open My Games",
			expectedResult: "My Games list",
			stepIndex: 0,
			screenSnapshot: "(empty tree)",
		};
		const withKnowledge = formatDecidePrompt({
			...base,
			appKnowledge:
				"Cold start shows a 'Verifying your installation' splash — tap Continue. Bottom nav: Discover / My Games / Rewards / Profile.",
		});
		expect(withKnowledge).toContain("App knowledge");
		expect(withKnowledge).toContain("Verifying your installation");
		expect(withKnowledge).toContain("Discover / My Games / Rewards / Profile");

		const without = formatDecidePrompt({ ...base, appKnowledge: "   " });
		expect(without).not.toContain("App knowledge");
	});

	test("caps oversized app knowledge instead of sending the whole document", () => {
		const prompt = formatDecidePrompt({
			appContext: "Playzone",
			caseTitle: "Check Navigation",
			instructions: "Open My Games",
			expectedResult: "My Games list",
			stepIndex: 0,
			screenSnapshot: "(empty tree)",
			appKnowledge: "x".repeat(5000),
		});
		expect(prompt).toContain("truncated");
		expect(prompt).not.toContain("x".repeat(2049));
	});
});

describe("SYSTEM_PROMPT dual-context and keyboard guidance", () => {
	test("instructs the agent on visual and structural context and choosing x,y vs id", () => {
		expect(SYSTEM_PROMPT).toContain("BOTH visual screenshots and screen snapshots");
		expect(SYSTEM_PROMPT).toContain("Visual context (screenshot)");
		expect(SYSTEM_PROMPT).toContain("Structural context (screen snapshot)");
		expect(SYSTEM_PROMPT).toContain('Decide whether to target by "id" or "x,y"');
	});

	test("instructs the agent on textfield keyboard dismissal, return key, and obscured buttons", () => {
		expect(SYSTEM_PROMPT).toContain("Textfield input and keyboard handling");
		expect(SYSTEM_PROMPT).toContain("Dismiss keyboard by tapping away");
		expect(SYSTEM_PROMPT).toContain("Nextline / Return on keyboard");
		expect(SYSTEM_PROMPT).toContain("Dismiss then use app buttons");
	});
});

describe("decisionToActionRequest for keyboard and field actions", () => {
	test("maps tap away coordinates to tap action request", () => {
		const req = decisionToActionRequest({
			type: "tap",
			x: 500,
			y: 250,
			reason: "Tap away on neutral background area to dismiss keyboard",
			thoughts: "Soft keyboard is obscuring the bottom, tapping blank space above it",
		});
		expect(req).toEqual({ kind: "tap", x: 500, y: 250 });
	});

	test("maps return key tap on keyboard by coordinates", () => {
		const req = decisionToActionRequest({
			type: "tap",
			x: 920,
			y: 950,
			reason: "Tap Return key on virtual keyboard",
			thoughts: "Pressing Return on the keyboard to submit the input",
		});
		expect(req).toEqual({ kind: "tap", x: 920, y: 950 });
	});

	test("maps input with newline to input action request", () => {
		const req = decisionToActionRequest({
			type: "type",
			id: "search_input",
			text: "my query\n",
			reason: "Type search query with newline to trigger submit",
			thoughts: "Entering query and pressing enter via newline",
		});
		expect(req).toEqual({ kind: "input", id: "search_input", text: "my query\n" });
	});
});
