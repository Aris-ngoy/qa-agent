import { describe, expect, it } from "bun:test";
import type { ActionRequest, CaseScript, CatalogCase } from "@yoqa/runner-client";
import type { DeviceSession } from "../devices/session";
import type { ActiveProviderAuth } from "../providers/application";
import type { AgentDecision } from "./agent";
import { executeAgentCase, executeScriptCase } from "./case-executor";

function fakeSession(shotCount = { n: 0 }): DeviceSession {
	return {
		screenshot: async () => {
			shotCount.n += 1;
			return { path: `/tmp/shot-${shotCount.n}.png`, base64: "aaa" };
		},
	} as unknown as DeviceSession;
}

function fakeAuth(): ActiveProviderAuth {
	return {
		id: "prov_test",
		kind: "openai",
		authMode: "api_key",
		apiKey: "sk-test",
		baseUrl: null,
		serverUrl: null,
		binaryPath: null,
		defaultModel: "gpt-4o",
		env: {},
	};
}

function emptyCase(overrides?: Partial<CatalogCase>): CatalogCase {
	return {
		id: "case_1",
		appId: "app_1",
		number: 1,
		name: "Login",
		tags: [],
		flows: [{ id: "flow_1", instructions: "Tap login", expectedResult: "Home", flowId: null }],
		capabilities: [],
		hasScript: false,
		scriptSavedAt: null,
		script: null,
		lastRunAt: null,
		lastRunStatus: null,
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

describe("executeScriptCase", () => {
	it("replays one tap via performAction and settles", async () => {
		const actions: ActionRequest[] = [];
		const steps: Array<{ idx: number; action: unknown }> = [];
		const sleeps: number[] = [];
		const script: CaseScript = {
			version: 1,
			sourceRunId: "run_1",
			savedAt: 1,
			actions: [{ type: "tap", x: 100, y: 200, reason: "tap login" }],
		};

		const status = await executeScriptCase({
			script,
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async (step) => {
				steps.push({ idx: step.idx, action: step.action });
			},
			performAction: async (_session, body) => {
				actions.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async (ms) => {
					sleeps.push(ms);
				},
				now: () => 1000,
			},
			settleMs: 10,
		});

		expect(status).toBe("passed");
		expect(actions).toEqual([{ kind: "tap", x: 100, y: 200 }]);
		expect(sleeps).toEqual([10]);
		expect(steps).toHaveLength(2);
		expect(steps[0]?.action).toMatchObject({ type: "tap", x: 100, y: 200 });
		expect(steps[1]?.action).toMatchObject({ type: "done" });
	});

	it("replays label taps and visible asserts", async () => {
		const actions: ActionRequest[] = [];
		const script: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "assert", assertion: "visible", text: "Yoqa Demo", timeoutMs: 5_000 },
				{ type: "tap", label: "Increment" },
			],
		};

		const status = await executeScriptCase({
			script,
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			performAction: async (_session, body) => {
				actions.push(body);
				return { ok: true, kind: body.kind };
			},
			readScreen: async () => ({
				elements: [{ label: "Yoqa Demo", type: "Text", x: 0, y: 0, width: 10, height: 10 }],
			}),
			clock: {
				sleep: async () => {},
				now: () => 1000,
			},
			settleMs: 0,
		});

		expect(status).toBe("passed");
		expect(actions).toEqual([{ kind: "tap", label: "Increment" }]);
	});

	it("replays accept-alert", async () => {
		const actions: ActionRequest[] = [];
		const script: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: [{ type: "alert", alertAction: "accept" }],
		};

		const status = await executeScriptCase({
			script,
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			performAction: async (_session, body) => {
				actions.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1000,
			},
			settleMs: 0,
		});

		expect(status).toBe("passed");
		expect(actions).toEqual([{ kind: "alert", alertAction: "accept" }]);
	});

	it("replays swipe coordinates via performAction", async () => {
		const actions: ActionRequest[] = [];
		const script: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: [{ type: "swipe", x: 500, y: 800, x2: 500, y2: 200, reason: "scroll down" }],
		};

		const status = await executeScriptCase({
			script,
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			performAction: async (_session, body) => {
				actions.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1000,
			},
			settleMs: 0,
		});

		expect(status).toBe("passed");
		expect(actions).toEqual([{ kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 }]);
	});

	it("cancels mid-loop when aborted", async () => {
		let shots = 0;
		const script: CaseScript = {
			version: 1,
			sourceRunId: "run_1",
			savedAt: 1,
			actions: [
				{ type: "tap", x: 1, y: 1 },
				{ type: "tap", x: 2, y: 2 },
			],
		};

		const status = await executeScriptCase({
			script,
			session: fakeSession({ n: 0 }),
			isAborted: () => {
				shots += 1;
				return shots > 1;
			},
			appendStep: async () => {},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(status).toBe("cancelled");
	});

	it("publishes the command before performAction and clears it after appendStep", async () => {
		const timeline: string[] = [];
		const script: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: [{ type: "tap", x: 100, y: 200, reason: "tap login" }],
		};

		const status = await executeScriptCase({
			script,
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async (step) => {
				timeline.push(`append:${step.command ?? "null"}`);
			},
			setCurrentCommand: async (command) => {
				timeline.push(command ?? "null");
			},
			performAction: async (_session, body) => {
				timeline.push(`perform:${body.kind}`);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1000,
			},
			settleMs: 0,
		});

		expect(status).toBe("passed");
		expect(timeline).toEqual([
			"yoqa action tap --x 100 --y 200",
			"perform:tap",
			"append:yoqa action tap --x 100 --y 200",
			"null",
			"append:null",
		]);
	});
});

describe("executeAgentCase", () => {
	it("stops when injected decide returns done", async () => {
		const performed: ActionRequest[] = [];
		const decisions: AgentDecision[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						x: 50,
						y: 60,
						reason: "tap",
						thoughts: "see button",
					};
				}
				return {
					type: "done",
					reason: "done",
					thoughts: "home visible",
				};
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(performed).toEqual([{ kind: "tap", x: 50, y: 60 }]);
		expect(result.decisions).toHaveLength(2);
		decisions.push(...result.decisions);
		expect(decisions[1]?.type).toBe("done");
	});

	it("publishes the tap command before performAction", async () => {
		const timeline: string[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async (step) => {
				timeline.push(`append:${step.command ?? "null"}`);
			},
			setCurrentCommand: async (command) => {
				timeline.push(command ?? "null");
			},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						label: "Allow",
						reason: "Grant notifications",
						thoughts: "Permission dialog",
					};
				}
				return {
					type: "done",
					reason: "done",
					thoughts: "home visible",
				};
			},
			performAction: async (_session, body) => {
				timeline.push(`perform:${body.kind}`);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(timeline).toEqual([
			"yoqa action tap --label 'Allow'",
			"perform:tap",
			"append:yoqa action tap --label 'Allow'",
			"null",
			"append:null",
		]);
	});

	it("taps by label and accepts alerts without guessed coordinates", async () => {
		const performed: ActionRequest[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						label: "Allow",
						x: 269,
						y: 951,
						reason: "Grant notifications",
						thoughts: "Permission dialog visible",
					};
				}
				if (calls === 2) {
					return {
						type: "alert",
						alertAction: "accept",
						reason: "Accept leftover alert",
						thoughts: "Still a system prompt",
					};
				}
				return {
					type: "done",
					reason: "done",
					thoughts: "home visible",
				};
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(performed).toEqual([
			{ kind: "tap", label: "Allow" },
			{ kind: "alert", alertAction: "accept" },
		]);
	});

	it("uses screenshot x,y for in-app taps even when a label is also present", async () => {
		const performed: ActionRequest[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						label: "Login",
						x: 120,
						y: 340,
						reason: "Tap login",
						thoughts: "Login button on the screenshot",
					};
				}
				return {
					type: "done",
					reason: "done",
					thoughts: "home visible",
				};
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(performed).toEqual([{ kind: "tap", x: 120, y: 340 }]);
	});

	it("performs directional swipe as screenshot coordinates", async () => {
		const performed: ActionRequest[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "swipe",
						direction: "up",
						reason: "Scroll to the bottom",
						thoughts: "Feed continues below",
					};
				}
				return {
					type: "done",
					reason: "done",
					thoughts: "bottom visible",
				};
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(performed).toEqual([{ kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 }]);
	});

	it("coerces scroll-intent taps into swipes and will not pass until a swipe stops moving the screen", async () => {
		const performed: ActionRequest[] = [];
		const steps: Array<{ type?: string }> = [];
		let calls = 0;
		let shot = 0;
		const session = {
			screenshot: async () => {
				shot += 1;
				const base64 = shot === 1 ? "moving-1" : "stable";
				return { path: `/tmp/shot-${shot}.png`, base64 };
			},
		} as unknown as DeviceSession;

		const result = await executeAgentCase({
			catalogCase: emptyCase({
				name: "#7 Scroll up And Down",
				flows: [
					{
						id: "flow_1",
						instructions: "Scroll down until you can not scroll anymore",
						expectedResult:
							"should scroll right at the bottom where it should not be able to scroll again",
						flowId: null,
					},
				],
			}),
			appContext: "demo",
			auth: fakeAuth(),
			session,
			isAborted: () => false,
			appendStep: async (step) => {
				steps.push(step.action as { type?: string });
			},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						x: 270,
						y: 900,
						reason: "Scroll down to reach the bottom of the page",
						thoughts: "I see Discover and need to scroll down further.",
					};
				}
				return {
					type: "verify",
					reason: "The screen has remained unchanged after multiple scroll attempts",
					thoughts: "Same four games are visible, so this must be the bottom.",
				};
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(performed).toEqual([
			{ kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 },
			{ kind: "swipe", x: 500, y: 800, x2: 500, y2: 200 },
		]);
		expect(steps.map((step) => step.type)).toEqual(["swipe", "swipe", "verify"]);
		expect(result.decisions.map((decision) => decision.type)).toEqual(["swipe", "swipe", "verify"]);
	});

	it("cancels when aborted during agent loop", async () => {
		let decideCalls = 0;
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => decideCalls >= 1,
			appendStep: async () => {},
			decide: async () => {
				decideCalls += 1;
				return {
					type: "tap",
					x: 1,
					y: 1,
					reason: "tap",
					thoughts: "tap",
				};
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("cancelled");
	});

	it("passes the screen snapshot into decide and retries after ActionNotFoundError", async () => {
		const { ActionNotFoundError } = await import("../devices/interaction");
		const snapshots: string[] = [];
		const errors: Array<string | undefined> = [];
		const performed: ActionRequest[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			readScreen: async () => ({
				elements: [
					{
						type: "Button",
						label: "Login",
						id: "login_btn",
						x: 100,
						y: 200,
						width: 120,
						height: 40,
					},
				],
			}),
			decide: async (input) => {
				snapshots.push(input.screenSnapshot ?? "");
				errors.push(input.lastError);
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						id: "missing_id",
						reason: "Tap login",
						thoughts: "Guessed a stale id",
					};
				}
				if (calls === 2) {
					return {
						type: "tap",
						id: "login_btn",
						reason: "Tap login from tree",
						thoughts: "Used the snapshot id after the miss",
					};
				}
				return { type: "done", reason: "done", thoughts: "ok" };
			},
			performAction: async (_session, body) => {
				if (body.id === "missing_id") {
					throw new ActionNotFoundError("No element matching id: missing_id");
				}
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(snapshots[0]).toContain("id=login_btn");
		expect(errors[1]).toContain("missing_id");
		expect(performed).toEqual([{ kind: "tap", id: "login_btn" }]);
		expect(result.decisions[0]?.id).toBe("login_btn");
		expect(result.decisions.map((decision) => decision.type)).toContain("done");
	});

	it("falls back to screenshot x,y when a tree id tap misses", async () => {
		const { ActionNotFoundError } = await import("../devices/interaction");
		const performed: ActionRequest[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						id: "stale_id",
						x: 120,
						y: 340,
						reason: "Tap login",
						thoughts: "Id from an older tree",
					};
				}
				return { type: "done", reason: "done", thoughts: "ok" };
			},
			performAction: async (_session, body) => {
				if (body.id === "stale_id") {
					throw new ActionNotFoundError("No element matching id: stale_id");
				}
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(calls).toBe(2);
		expect(performed).toEqual([{ kind: "tap", x: 120, y: 340 }]);
	});

	it("performs drag and activate-app through performAction", async () => {
		const performed: ActionRequest[] = [];
		let calls = 0;
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			defaultAppId: "com.example.app",
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "drag",
						x: 100,
						y: 500,
						x2: 800,
						y2: 500,
						reason: "Slide",
						thoughts: "Slider",
					};
				}
				if (calls === 2) {
					return {
						type: "activate-app",
						reason: "Foreground",
						thoughts: "App backgrounded",
					};
				}
				return { type: "done", reason: "done", thoughts: "ok" };
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(performed).toEqual([
			{ kind: "drag", x: 100, y: 500, x2: 800, y2: 500 },
			{ kind: "activate-app", appId: "com.example.app" },
		]);
	});

	it("runs numbered instructions one at a time and does not finish the case on the first verify", async () => {
		const seen: Array<{
			instructions: string;
			expectedResult: string;
			completed?: string[];
			ordinal?: number;
			count?: number;
		}> = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase({
				name: "Payout",
				number: 8,
				flows: [
					{
						id: "flow_1",
						instructions:
							"1. Navigate to Rewards\n2. Tap on paypal pick any amount\n3. Tap on confirm",
						expectedResult: "should complete the payout and see the Payout Success text",
						flowId: null,
					},
				],
			}),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async (input) => {
				calls += 1;
				seen.push({
					instructions: input.instructions,
					expectedResult: input.expectedResult,
					completed: [...(input.completedInstructions ?? [])],
					ordinal: input.instructionOrdinal,
					count: input.instructionCount,
				});
				if (calls % 2 === 1) {
					return {
						type: "tap",
						x: 100,
						y: 200,
						reason: `do ${input.instructions}`,
						thoughts: "visible",
					};
				}
				return {
					type: "verify",
					reason: `done ${input.instructions}`,
					thoughts: "expected visible",
				};
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(calls).toBe(6);
		expect(seen.map((item) => item.instructions)).toEqual([
			"Navigate to Rewards",
			"Navigate to Rewards",
			"Tap on paypal pick any amount",
			"Tap on paypal pick any amount",
			"Tap on confirm",
			"Tap on confirm",
		]);
		expect(seen[0]?.expectedResult).toBe("");
		expect(seen[2]?.expectedResult).toBe("");
		expect(seen[4]?.expectedResult).toContain("Payout Success");
		expect(seen[0]?.completed).toEqual([]);
		expect(seen[2]?.completed).toEqual(["Navigate to Rewards"]);
		expect(seen[4]?.completed).toEqual(["Navigate to Rewards", "Tap on paypal pick any amount"]);
		expect(seen.every((item) => item.count === 3)).toBe(true);
		expect(seen[0]?.ordinal).toBe(1);
		expect(seen[2]?.ordinal).toBe(2);
		expect(seen[4]?.ordinal).toBe(3);
		expect(seen.some((item) => item.instructions.includes("1. Navigate"))).toBe(false);
	});

	it("does not put later catalog-flow instructions into the current decide call", async () => {
		const seen: string[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase({
				name: "Payout",
				number: 8,
				flows: [
					{
						id: "flow_1",
						instructions: "Navigate to Rewards",
						expectedResult: "should see the list of payout options",
						flowId: null,
					},
					{
						id: "flow_2",
						instructions: "Tap on paypal pick any amount",
						expectedResult: "should see the payout detail screen",
						flowId: null,
					},
					{
						id: "flow_3",
						instructions: "Tap on Hello Fresh",
						expectedResult: "should see the payout detail screen",
						flowId: null,
					},
				],
			}),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async (input) => {
				calls += 1;
				seen.push(input.instructions);
				return {
					type: "verify",
					reason: "this instruction is done",
					thoughts: "matches expected",
				};
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(calls).toBe(3);
		expect(seen).toEqual([
			"Navigate to Rewards",
			"Tap on paypal pick any amount",
			"Tap on Hello Fresh",
		]);
	});
});
