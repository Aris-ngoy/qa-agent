import { describe, expect, it } from "bun:test";
import type {
	ActionRequest,
	CaseScript,
	CatalogCase,
	ScreenElement,
	StepPhases,
} from "@yoqa/runner-client";
import type { DeviceSession } from "../devices/session";
import type { ActiveProviderAuth } from "../providers/application";
import type { AgentDecision } from "./agent";
import { executeAgentCase, executeScriptCase } from "./case-executor";
import { encodeRgbaPng } from "./coord-grid";

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
			"append:yoqa action tap --label 'Allow'",
			"yoqa action tap --label 'Allow'",
			"perform:tap",
			"null",
			"append:yoqa action tap --label 'Allow'",
		]);
		expect(timeline.indexOf("yoqa action tap --label 'Allow'")).toBeLessThan(
			timeline.indexOf("perform:tap"),
		);
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
			screenMode: "tree",
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
		expect(result.decisions[0]?.id).toBe("missing_id");
		expect(result.decisions.map((decision) => decision.type)).toContain("done");
	});

	it("prepares the vision image once per screenshot and reuses it across retries", async () => {
		const { ActionNotFoundError } = await import("../devices/interaction");
		const images: Array<unknown> = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				images.push(input.image);
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						id: "missing_id",
						reason: "Tap login",
						thoughts: "Guessed a stale id",
					};
				}
				return { type: "done", reason: "done", thoughts: "ok" };
			},
			performAction: async (_session, body) => {
				if (body.id === "missing_id") {
					throw new ActionNotFoundError("No element matching id: missing_id");
				}
				return { ok: true, kind: body.kind };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(images).toHaveLength(2);
		expect(images[0]).toEqual({ base64: "aaa", mediaType: "image/png" });
		expect(images[1]).toBe(images[0]);
	});

	it("records a per-phase timing breakdown and decide retry count on each step", async () => {
		const steps: Array<{ latencyMs: number; phases?: StepPhases | null }> = [];
		let t = 0;
		let calls = 0;
		const clock = {
			sleep: async () => {},
			now: () => {
				t += 10;
				return t;
			},
		};

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async (step) => {
				steps.push({ latencyMs: step.latencyMs, phases: step.phases });
			},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				calls += 1;
				if (calls === 1) {
					input.onDecideRetry?.();
					return { type: "tap", x: 100, y: 200, reason: "Tap center", thoughts: "tapping" };
				}
				return { type: "done", reason: "done", thoughts: "ok" };
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock,
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		const first = steps[0];
		const phases = first?.phases;
		expect(phases).toBeDefined();
		expect(phases?.decideRetries).toBe(1);
		expect(phases?.captureMs).toBeGreaterThan(0);
		expect(phases?.screenMs).toBeGreaterThan(0);
		expect(phases?.prepareMs).toBeGreaterThan(0);
		expect(phases?.decideMs).toBeGreaterThan(0);
		expect(first?.latencyMs).toBe(
			(phases?.captureMs ?? 0) +
				(phases?.screenMs ?? 0) +
				(phases?.prepareMs ?? 0) +
				(phases?.decideMs ?? 0),
		);
	});

	it("adds up Call usage across decide retries and verify on the step's phases", async () => {
		const steps: Array<StepPhases | null | undefined> = [];
		let calls = 0;
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async (step) => {
				steps.push(step.phases);
			},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				calls += 1;
				if (calls === 1) {
					input.onUsage?.({
						inputTokens: 100,
						cachedInputTokens: 0,
						cacheWriteTokens: 900,
						outputTokens: 20,
					});
					return { type: "fail", reason: "No screenshot provided", thoughts: "I see nothing" };
				}
				input.onUsage?.({
					inputTokens: 100,
					cachedInputTokens: 900,
					cacheWriteTokens: null,
					outputTokens: 30,
				});
				return { type: "tap", x: 10, y: 20, reason: "Tap", thoughts: "button" };
			},
			verify: async (input) => {
				input.onUsage?.({
					inputTokens: 50,
					cachedInputTokens: 900,
					cacheWriteTokens: 0,
					outputTokens: 10,
				});
				return { type: "verify", reason: "Done", thoughts: "ok" };
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(steps[0]?.decideRetries).toBe(1);
		expect(steps[0]?.usage).toEqual({
			inputTokens: 250,
			cachedInputTokens: 1800,
			cacheWriteTokens: 900,
			outputTokens: 60,
		});
	});

	it("adds up Call usage across the grid cell retry and verify on the step's phases", async () => {
		const png = encodeRgbaPng({
			width: 40,
			height: 80,
			rgba: new Uint8Array(40 * 80 * 4).fill(255),
		}).toString("base64");
		const steps: Array<StepPhases | null | undefined> = [];
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "This is a mobile game.",
			auth: fakeAuth(),
			session: {
				screenshot: async () => ({ path: "/tmp/game.png", base64: png }),
			} as unknown as DeviceSession,
			isAborted: () => false,
			appendStep: async (step) => {
				steps.push(step.phases);
			},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				if (input.lastError?.includes("col and row")) {
					input.onUsage?.({
						inputTokens: 40,
						cachedInputTokens: 700,
						cacheWriteTokens: null,
						outputTokens: 15,
					});
					return {
						type: "tap",
						col: 1,
						row: 2,
						reason: "Tap play",
						thoughts: "Play is in cell 1-2",
					};
				}
				input.onUsage?.({
					inputTokens: 60,
					cachedInputTokens: 0,
					cacheWriteTokens: 700,
					outputTokens: 25,
				});
				return { type: "tap", x: 12, y: 34, reason: "Tap play", thoughts: "Guessed a point" };
			},
			verify: async (input) => {
				input.onUsage?.({
					inputTokens: 20,
					cachedInputTokens: 700,
					cacheWriteTokens: null,
					outputTokens: 5,
				});
				return { type: "verify", reason: "Done", thoughts: "The level started" };
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(steps[0]?.decideRetries).toBe(1);
		expect(steps[0]?.usage).toEqual({
			inputTokens: 120,
			cachedInputTokens: 1400,
			cacheWriteTokens: 700,
			outputTokens: 45,
		});
	});

	it("adds up Call usage across the screenshot point retry and verify on the step's phases", async () => {
		const steps: Array<StepPhases | null | undefined> = [];
		let calls = 0;
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "Rewards app",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async (step) => {
				steps.push(step.phases);
			},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				calls += 1;
				if (calls === 1) {
					input.onUsage?.({
						inputTokens: 80,
						cachedInputTokens: null,
						cacheWriteTokens: 500,
						outputTokens: 10,
					});
					return { type: "tap", label: "Login", reason: "Tap login", thoughts: "No point given" };
				}
				input.onUsage?.({
					inputTokens: 90,
					cachedInputTokens: 500,
					cacheWriteTokens: null,
					outputTokens: 20,
				});
				return { type: "tap", x: 200, y: 440, reason: "Tap login", thoughts: "Login button" };
			},
			verify: async (input) => {
				input.onUsage?.({
					inputTokens: 30,
					cachedInputTokens: 500,
					cacheWriteTokens: null,
					outputTokens: null,
				});
				return { type: "verify", reason: "Done", thoughts: "Logged in" };
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(calls).toBe(2);
		expect(steps[0]?.decideRetries).toBe(1);
		expect(steps[0]?.usage).toEqual({
			inputTokens: 200,
			cachedInputTokens: 1000,
			cacheWriteTokens: 500,
			outputTokens: 30,
		});
	});

	it("leaves Call usage out of the step's phases when no call reports it", async () => {
		const steps: Array<StepPhases | null | undefined> = [];
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async (step) => {
				steps.push(step.phases);
			},
			readScreen: async () => ({ elements: [] }),
			decide: async () => ({ type: "tap", x: 10, y: 20, reason: "Tap", thoughts: "button" }),
			verify: async () => ({ type: "verify", reason: "Done", thoughts: "ok" }),
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(steps[0]).toBeDefined();
		expect(steps[0] && "usage" in steps[0]).toBe(false);
	});

	it("reads the Screen once per step and reuses it for id taps", async () => {
		let pageSourceCalls = 0;
		const taps: Array<{ x: number; y: number }> = [];
		let calls = 0;
		const session = {
			screenshot: async () => ({ path: "/tmp/shot-reuse.png", base64: "aaa" }),
			pageSource: async () => {
				pageSourceCalls += 1;
				return `<XCUIElementTypeApplication name="App" x="0" y="0" width="390" height="844">
					<XCUIElementTypeButton name="login_btn" label="Login" x="100" y="400" width="120" height="40" visible="true" enabled="true" />
				</XCUIElementTypeApplication>`;
			},
			getWindowSize: async () => ({ width: 390, height: 844 }),
			tap: async (x: number, y: number) => {
				taps.push({ x, y });
			},
		} as unknown as DeviceSession;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			screenMode: "tree",
			session,
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return { type: "tap", id: "login_btn", reason: "Tap login", thoughts: "tree id" };
				}
				return { type: "done", reason: "done", thoughts: "ok" };
			},
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(taps).toHaveLength(1);
		expect(pageSourceCalls).toBe(2);
	});

	it("passes app knowledge from the case deps into decide", async () => {
		const knowledge: string[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			appKnowledge: "Cold start shows a verification splash — tap Continue.",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				calls += 1;
				knowledge.push(input.appKnowledge ?? "");
				if (calls === 1) {
					return { type: "tap", x: 100, y: 200, reason: "Tap", thoughts: "tapping" };
				}
				return { type: "done", reason: "done", thoughts: "ok" };
			},
			performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
			clock: {
				sleep: async () => {},
				now: () => 1,
			},
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(knowledge[0]).toBe("Cold start shows a verification splash — tap Continue.");
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

	it("executes typing into a textfield, tapping away to dismiss keyboard, and tapping revealed app button", async () => {
		const performed: ActionRequest[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase({
				flows: [
					{
						id: "flow_1",
						instructions: "Type into search, dismiss keyboard, and submit",
						expectedResult: "should see search results",
						flowId: null,
					},
				],
			}),
			appContext: "demo",
			auth: fakeAuth(),
			screenMode: "tree",
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			readScreen: async () => ({
				elements: [
					{
						type: "TextField",
						label: "Search",
						id: "search_input",
						x: 50,
						y: 100,
						width: 400,
						height: 50,
					},
					{
						type: "Button",
						label: "Submit",
						id: "submit_btn",
						x: 50,
						y: 800,
						width: 200,
						height: 60,
					},
				],
			}),
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					// 1. Type into textfield
					return {
						type: "type",
						id: "search_input",
						text: "react native",
						reason: "Type search query into search input",
						thoughts: "Found search input field on screen, entering query text",
					};
				}
				if (calls === 2) {
					// 2. Keyboard is now open, tap away on neutral area to dismiss
					return {
						type: "tap",
						x: 500,
						y: 200,
						reason: "Tap away on background to dismiss soft keyboard",
						thoughts: "Keyboard is covering bottom screen, tapping neutral space to dismiss",
					};
				}
				if (calls === 3) {
					// 3. Tap the revealed submit button
					return {
						type: "tap",
						id: "submit_btn",
						reason: "Tap submit button now visible",
						thoughts: "Keyboard is dismissed, submit button is now visible to tap",
					};
				}
				return {
					type: "verify",
					reason: "Search submitted and results visible",
					thoughts: "Results screen is displayed",
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
		expect(calls).toBe(4);
		expect(performed).toEqual([
			{ kind: "input", id: "search_input", text: "react native" },
			{ kind: "tap", x: 500, y: 200 },
			{ kind: "tap", id: "submit_btn" },
		]);
	});

	it("executes input with newline to advance or submit via keyboard", async () => {
		const performed: ActionRequest[] = [];
		let calls = 0;

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			screenMode: "tree",
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "type",
						id: "search_input",
						text: "my query\n",
						reason: "Type search query with return key",
						thoughts: "Entering text and pressing enter via newline",
					};
				}
				return {
					type: "verify",
					reason: "Search results visible",
					thoughts: "Search completed",
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
		expect(performed).toEqual([{ kind: "input", id: "search_input", text: "my query\n" }]);
	});

	it("taps the screenshot point on a game instead of the full-screen surface", async () => {
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
						type: "View",
						label: "UnityView",
						id: "unity_surface",
						x: 0,
						y: 0,
						width: 1000,
						height: 1000,
					},
				],
			}),
			decide: async () => {
				calls += 1;
				if (calls === 1) {
					return {
						type: "tap",
						id: "unity_surface",
						x: 180,
						y: 640,
						reason: "Tap play",
						thoughts: "Play is on the left of the board",
					};
				}
				return { type: "done", reason: "done", thoughts: "level started" };
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(performed).toEqual([{ kind: "tap", x: 180, y: 640 }]);
	});

	it("screenshots a game and taps x,y without reading yoqa screen", async () => {
		const performed: ActionRequest[] = [];
		let screenReads = 0;
		let calls = 0;
		let snapshot = "";

		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "This is a mobile game. Tap the green play button.",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			readScreen: async () => {
				screenReads += 1;
				return {
					elements: [
						{
							type: "Button",
							label: "Play",
							id: "play_btn",
							x: 100,
							y: 400,
							width: 200,
							height: 80,
						},
					],
				};
			},
			decide: async (input) => {
				calls += 1;
				snapshot = input.screenSnapshot ?? "";
				if (calls === 1) {
					return {
						type: "tap",
						id: "play_btn",
						label: "Play",
						x: 220,
						y: 610,
						reason: "Tap play",
						thoughts: "The green button is left of centre",
					};
				}
				return { type: "done", reason: "done", thoughts: "level started" };
			},
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(screenReads).toBe(0);
		expect(snapshot).toContain("no accessibility tree");
		expect(performed).toEqual([{ kind: "tap", x: 220, y: 610 }]);
	});

	it("verifies after the decision and does not perform the tap when the instruction already passed", async () => {
		const order: string[] = [];
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				order.push("decision");
				return {
					type: "tap",
					x: 180,
					y: 640,
					reason: "Tap play",
					thoughts: "Play is visible",
				};
			},
			verify: async () => {
				order.push("verify");
				return {
					type: "verify",
					reason: "The level already started",
					thoughts: "Success text is on screen",
				};
			},
			performAction: async () => {
				order.push("perform");
				return { ok: true, kind: "tap" };
			},
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(order).toEqual(["decision", "verify"]);
	});

	it("performs the previous decision before the next screenshot, decision, and verify", async () => {
		const order: string[] = [];
		let verifyCalls = 0;
		const result = await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			session: fakeSession(),
			isAborted: () => false,
			appendStep: async () => {},
			decide: async () => {
				order.push("decision");
				return {
					type: "tap",
					x: 10,
					y: 20,
					reason: "Tap",
					thoughts: "button",
				};
			},
			verify: async () => {
				verifyCalls += 1;
				order.push("verify");
				return verifyCalls === 1
					? { type: "continue", reason: "Not done", thoughts: "Still on the menu" }
					: { type: "verify", reason: "Done", thoughts: "Result is visible" };
			},
			performAction: async () => {
				order.push("perform");
				return { ok: true, kind: "tap" };
			},
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(result.status).toBe("passed");
		expect(order).toEqual(["decision", "verify", "perform", "decision", "verify"]);
	});

	it("sends a coordinate grid when the screen is a canvas", async () => {
		const png = encodeRgbaPng({
			width: 40,
			height: 80,
			rgba: new Uint8Array(40 * 80 * 4).fill(255),
		}).toString("base64");
		let coordGrid = false;
		let imageBase64 = "";
		let calls = 0;

		await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "demo",
			auth: fakeAuth(),
			screenMode: "tree",
			session: {
				screenshot: async () => ({ path: "/tmp/game.png", base64: png }),
			} as unknown as DeviceSession,
			isAborted: () => false,
			appendStep: async () => {},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				calls += 1;
				coordGrid = input.coordGrid === true;
				imageBase64 = input.imageBase64;
				return { type: "done", reason: "done", thoughts: "nothing to tap" };
			},
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(calls).toBe(1);
		expect(coordGrid).toBe(true);
		expect(imageBase64).not.toBe(png);
	});

	it("taps the point computed from the grid cell, not the model's x,y", async () => {
		const png = encodeRgbaPng({
			width: 40,
			height: 80,
			rgba: new Uint8Array(40 * 80 * 4).fill(255),
		}).toString("base64");
		const performed: ActionRequest[] = [];
		let decides = 0;

		await executeAgentCase({
			catalogCase: emptyCase(),
			appContext: "This is a mobile game.",
			auth: fakeAuth(),
			session: {
				screenshot: async () => ({ path: "/tmp/game.png", base64: png }),
			} as unknown as DeviceSession,
			isAborted: () => false,
			appendStep: async () => {},
			readScreen: async () => ({ elements: [] }),
			decide: async (input) => {
				decides += 1;
				if (input.lastError?.includes("col and row")) {
					return {
						type: "tap",
						col: 1,
						row: 2,
						qx: 0,
						qy: 9,
						reason: "Tap play",
						thoughts: "Play is in cell 1-2, low in the cell",
					};
				}
				if (decides > 1) {
					return { type: "done", reason: "done", thoughts: "The level started" };
				}
				return {
					type: "tap",
					x: 12,
					y: 34,
					reason: "Tap play",
					thoughts: "Guessed a point on the left",
				};
			},
			verify: async () =>
				decides < 3
					? { type: "continue", reason: "Not done", thoughts: "Still on the menu" }
					: { type: "verify", reason: "Done", thoughts: "The level started" },
			performAction: async (_session, body) => {
				performed.push(body);
				return { ok: true, kind: body.kind };
			},
			clock: { sleep: async () => {}, now: () => 1 },
			settleMs: 0,
		});

		expect(performed[0]).toMatchObject({ kind: "tap", x: 105, y: 295 });
	});

	describe("Screen modes", () => {
		const plainPng = (fill: number) =>
			encodeRgbaPng({
				width: 40,
				height: 80,
				rgba: new Uint8Array(40 * 80 * 4).fill(fill),
			}).toString("base64");

		const tapAt = (x: number, y: number): AgentDecision => ({
			type: "tap",
			x,
			y,
			reason: "Tap the control",
			thoughts: "The control is at this point",
		});

		it("defaults to vision: no Screen is read or sent, and the tap runs from x,y", async () => {
			const performed: ActionRequest[] = [];
			let screenReads = 0;
			let calls = 0;
			const seen: Array<{ screenshotOnly?: boolean; coordGrid?: boolean; snapshot?: string }> = [];

			const result = await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				session: fakeSession(),
				isAborted: () => false,
				appendStep: async () => {},
				readScreen: async () => {
					screenReads += 1;
					return {
						elements: [
							{
								type: "Button",
								label: "Login",
								id: "login_btn",
								x: 100,
								y: 400,
								width: 200,
								height: 80,
							},
						],
					};
				},
				decide: async (input) => {
					calls += 1;
					seen.push({
						screenshotOnly: input.screenshotOnly,
						coordGrid: input.coordGrid,
						snapshot: input.screenSnapshot,
					});
					if (calls === 1) {
						return {
							type: "tap",
							id: "login_btn",
							label: "Login",
							x: 200,
							y: 440,
							reason: "Tap login",
							thoughts: "Login is the blue button",
						};
					}
					return { type: "done", reason: "done", thoughts: "Logged in" };
				},
				performAction: async (_session, body) => {
					performed.push(body);
					return { ok: true, kind: body.kind };
				},
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(result.status).toBe("passed");
			expect(screenReads).toBe(0);
			expect(seen[0]?.screenshotOnly).toBe(true);
			expect(seen[0]?.coordGrid).toBe(false);
			expect(seen[0]?.snapshot).not.toContain("login_btn");
			expect(performed).toEqual([{ kind: "tap", x: 200, y: 440 }]);
		});

		it("tree mode reads the Screen every step and still allows id taps", async () => {
			const performed: ActionRequest[] = [];
			let screenReads = 0;
			let calls = 0;
			let snapshot = "";

			await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				screenMode: "tree",
				session: fakeSession(),
				isAborted: () => false,
				appendStep: async () => {},
				readScreen: async () => {
					screenReads += 1;
					return {
						elements: [
							{
								type: "Button",
								label: "Login",
								id: "login_btn",
								x: 100,
								y: 400,
								width: 200,
								height: 80,
							},
							{
								type: "Button",
								label: "Help",
								id: "help_btn",
								x: 100,
								y: 500,
								width: 200,
								height: 80,
							},
							{
								type: "Button",
								label: "Back",
								id: "back_btn",
								x: 100,
								y: 600,
								width: 200,
								height: 80,
							},
						],
					};
				},
				decide: async (input) => {
					calls += 1;
					snapshot = input.screenSnapshot ?? "";
					if (calls === 1) {
						return {
							type: "tap",
							id: "login_btn",
							reason: "Tap login",
							thoughts: "Login has an id",
						};
					}
					return { type: "done", reason: "done", thoughts: "Logged in" };
				},
				performAction: async (_session, body) => {
					performed.push(body);
					return { ok: true, kind: body.kind };
				},
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(screenReads).toBeGreaterThan(0);
			expect(snapshot).toContain("id=login_btn");
			expect(performed).toEqual([{ kind: "tap", id: "login_btn" }]);
		});

		it("asks again when a vision tap names a control but gives no point", async () => {
			const performed: ActionRequest[] = [];
			const errors: Array<string | undefined> = [];
			let calls = 0;

			await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				session: fakeSession(),
				isAborted: () => false,
				appendStep: async () => {},
				decide: async (input) => {
					calls += 1;
					errors.push(input.lastError);
					if (calls === 1) {
						return {
							type: "tap",
							label: "Login",
							reason: "Tap login",
							thoughts: "The button says Login",
						};
					}
					if (calls === 2) return tapAt(300, 700);
					return { type: "done", reason: "done", thoughts: "Logged in" };
				},
				performAction: async (_session, body) => {
					performed.push(body);
					return { ok: true, kind: body.kind };
				},
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(errors[1]).toContain("Send x and y");
			expect(performed).toEqual([{ kind: "tap", x: 300, y: 700 }]);
		});

		it("starts a game app in Grid mode without escalating", async () => {
			const steps: Array<{ action: unknown }> = [];
			let coordGrid: boolean | undefined;
			const png = plainPng(255);

			await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "This is a mobile game.",
				auth: fakeAuth(),
				session: {
					screenshot: async () => ({ path: "/tmp/game.png", base64: png }),
				} as unknown as DeviceSession,
				isAborted: () => false,
				appendStep: async (step) => {
					steps.push(step);
				},
				decide: async (input) => {
					coordGrid = input.coordGrid;
					return { type: "done", reason: "done", thoughts: "Nothing to do" };
				},
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(coordGrid).toBe(true);
			expect(JSON.stringify(steps[0]?.action)).not.toContain("escalatedToGrid");
		});

		it("escalates to Grid mode after four x,y taps leave the screenshot unchanged, and stays there", async () => {
			const steps: Array<{ idx: number; action: unknown }> = [];
			const grids: boolean[] = [];
			const png = plainPng(255);
			let calls = 0;

			const result = await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				session: {
					screenshot: async () => ({ path: "/tmp/same.png", base64: png }),
				} as unknown as DeviceSession,
				isAborted: () => false,
				appendStep: async (step) => {
					steps.push(step);
				},
				decide: async (input) => {
					calls += 1;
					grids.push(input.coordGrid === true);
					if (calls <= 5) return tapAt(500, 500);
					return { type: "done", reason: "done", thoughts: "Finished" };
				},
				verify: async () => ({
					type: "continue",
					reason: "Not done",
					thoughts: "Still on the same screen",
				}),
				performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(result.status).toBe("passed");
			// Taps 1–4 changed nothing, so decide 5 is the first one with the grid, and later ones keep it.
			expect(grids.slice(0, 6)).toEqual([false, false, false, false, true, true]);
			const flagged = steps.filter((step) =>
				JSON.stringify(step.action).includes('"escalatedToGrid":true'),
			);
			expect(flagged.map((step) => step.idx)).toEqual([4]);
		});

		it("does not escalate when taps change the screenshot", async () => {
			const grids: boolean[] = [];
			const shots = [plainPng(255), plainPng(200), plainPng(150), plainPng(100), plainPng(50)];
			let shotIndex = 0;
			let calls = 0;

			await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				session: {
					screenshot: async () => {
						const base64 = shots[Math.min(shotIndex, shots.length - 1)] ?? shots[0] ?? "";
						shotIndex += 1;
						return { path: "/tmp/changing.png", base64 };
					},
				} as unknown as DeviceSession,
				isAborted: () => false,
				appendStep: async () => {},
				decide: async (input) => {
					calls += 1;
					grids.push(input.coordGrid === true);
					if (calls <= 3) return tapAt(500, 500);
					return { type: "done", reason: "done", thoughts: "Finished" };
				},
				verify: async () => ({
					type: "continue",
					reason: "Not done",
					thoughts: "Progressing",
				}),
				performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(grids.every((grid) => grid === false)).toBe(true);
		});

		it("does not count a swipe between two unchanged taps as consecutive taps", async () => {
			const grids: boolean[] = [];
			const png = plainPng(255);
			const plan: AgentDecision[] = [
				tapAt(500, 500),
				{ type: "swipe", direction: "up", reason: "Scroll", thoughts: "More below" },
				tapAt(500, 500),
			];
			let calls = 0;

			await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				session: {
					screenshot: async () => ({ path: "/tmp/same.png", base64: png }),
				} as unknown as DeviceSession,
				isAborted: () => false,
				appendStep: async () => {},
				decide: async (input) => {
					grids.push(input.coordGrid === true);
					const next = plan[calls];
					calls += 1;
					return next ?? { type: "done", reason: "done", thoughts: "Finished" };
				},
				verify: async () => ({ type: "continue", reason: "Not done", thoughts: "Still here" }),
				performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(grids.every((grid) => grid === false)).toBe(true);
		});

		it("hints after three waits on an unchanged screen, and not while the screen moves", async () => {
			const png = plainPng(255);
			const waitDecision: AgentDecision = {
				type: "wait",
				ms: 1000,
				reason: "Still loading",
				thoughts: "Preparing to download",
			};

			const run = async (shots: string[]) => {
				const errors: Array<string | undefined> = [];
				let shotIndex = 0;
				let calls = 0;
				await executeAgentCase({
					catalogCase: emptyCase(),
					appContext: "Rewards app",
					auth: fakeAuth(),
					session: {
						screenshot: async () => {
							const base64 = shots[Math.min(shotIndex, shots.length - 1)] ?? "";
							shotIndex += 1;
							return { path: "/tmp/wait.png", base64 };
						},
					} as unknown as DeviceSession,
					isAborted: () => false,
					appendStep: async () => {},
					decide: async (input) => {
						calls += 1;
						errors.push(input.lastError);
						return calls <= 6
							? waitDecision
							: { type: "done", reason: "done", thoughts: "Finished" };
					},
					verify: async () => ({ type: "continue", reason: "Not done", thoughts: "Waiting" }),
					performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
					clock: { sleep: async () => {}, now: () => 1 },
					settleMs: 0,
				});
				return errors;
			};

			const stuck = await run([png]);
			expect(stuck.slice(0, 3)).toEqual([undefined, undefined, undefined]);
			expect(stuck[3]).toContain("has not changed after 3 waits");
			expect(stuck[4]).toContain("has not changed after 4 waits");

			const moving = await run([
				plainPng(255),
				plainPng(200),
				plainPng(150),
				plainPng(100),
				plainPng(50),
				plainPng(25),
				plainPng(10),
			]);
			expect(moving.every((error) => error === undefined)).toBe(true);
		});

		it("adds the screen tree after two actions that leave the screenshot unchanged", async () => {
			const buttons = [
				{ type: "Button", label: "Allow", id: "Allow", x: 400, y: 640, width: 200, height: 80 },
				{ type: "Button", label: "Close", id: "close", x: 60, y: 90, width: 80, height: 60 },
			];
			const run = async (opts: { shots: string[]; appContext?: string; plan: AgentDecision[] }) => {
				const seen: Array<{ tree: boolean; snapshot: string; error?: string }> = [];
				const steps: Array<{ action: unknown }> = [];
				let shotIndex = 0;
				let calls = 0;
				await executeAgentCase({
					catalogCase: emptyCase(),
					appContext: opts.appContext ?? "Rewards app",
					auth: fakeAuth(),
					session: {
						screenshot: async () => {
							const base64 = opts.shots[Math.min(shotIndex, opts.shots.length - 1)] ?? "";
							shotIndex += 1;
							return { path: "/tmp/assist.png", base64 };
						},
					} as unknown as DeviceSession,
					isAborted: () => false,
					appendStep: async (step) => {
						steps.push(step);
					},
					readScreen: async () => ({ elements: buttons }),
					decide: async (input) => {
						seen.push({
							tree: input.screenshotOnly !== true,
							snapshot: input.screenSnapshot ?? "",
							error: input.lastError,
						});
						const next = opts.plan[calls];
						calls += 1;
						return next ?? { type: "done", reason: "done", thoughts: "Finished" };
					},
					verify: async () => ({ type: "continue", reason: "Not done", thoughts: "Still here" }),
					performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
					clock: { sleep: async () => {}, now: () => 1 },
					settleMs: 0,
				});
				return { seen, steps };
			};
			const swipe: AgentDecision = {
				type: "swipe",
				direction: "up",
				reason: "Scroll",
				thoughts: "More",
			};

			// Two unchanged actions of any kind, then the tree arrives with the screenshot.
			const stuck = await run({ shots: [plainPng(255)], plan: [swipe, swipe, swipe, swipe] });
			expect(stuck.seen.map((s) => s.tree)).toEqual([false, false, true, true, true]);
			expect(stuck.seen[2]?.snapshot).toContain("Allow");
			expect(JSON.stringify(stuck.steps[2]?.action)).toContain('"treeAssist":true');

			// A same-spot tap also gets the repeat hint, worded for the tree.
			const taps = await run({
				shots: [plainPng(255)],
				plan: [tapAt(50, 150), tapAt(50, 150), tapAt(50, 150)],
			});
			expect(taps.seen[2]?.tree).toBe(true);
			expect(taps.seen[2]?.error).toContain("tap it by its id");

			// The screen moving resets the count, and a wait neither counts nor resets it.
			const moving = await run({
				shots: [plainPng(255), plainPng(200), plainPng(150), plainPng(100), plainPng(50)],
				plan: [swipe, swipe, swipe, swipe],
			});
			expect(moving.seen.every((s) => !s.tree)).toBe(true);
			const wait: AgentDecision = { type: "wait", ms: 500, reason: "Load", thoughts: "Loading" };
			const waited = await run({ shots: [plainPng(255)], plan: [swipe, wait, swipe, swipe] });
			expect(waited.seen.map((s) => s.tree)).toEqual([false, false, false, true, true]);

			// A known game has no useful tree, so it keeps the grid and never gets one.
			const game = await run({
				shots: [plainPng(255)],
				appContext: "This is a mobile game.",
				plan: [swipe, swipe, swipe, swipe],
			});
			expect(game.seen.every((s) => !s.tree)).toBe(true);
		});

		it("snaps a tap that keeps missing onto the nearest control from the tree", async () => {
			const png = plainPng(255);
			const performed: ActionRequest[] = [];
			const steps: Array<{ action: unknown }> = [];
			let calls = 0;
			await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				session: {
					screenshot: async () => ({ path: "/tmp/same.png", base64: png }),
				} as unknown as DeviceSession,
				isAborted: () => false,
				appendStep: async (step) => {
					steps.push(step);
				},
				readScreen: async () => ({
					elements: [
						{ type: "Button", label: "Close", id: "close", x: 70, y: 90, width: 60, height: 50 },
					],
				}),
				// The model aims at 50,150 every time. The first two are plain taps.
				decide: async () => {
					calls += 1;
					return calls <= 4
						? tapAt(50, 150)
						: { type: "done", reason: "done", thoughts: "Finished" };
				},
				verify: async () => ({ type: "continue", reason: "Not done", thoughts: "Still here" }),
				performAction: async (_session, body) => {
					performed.push(body);
					return { ok: true, kind: body.kind };
				},
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			// Taps 1 and 2 go where the model aimed. After two misses the tree is read and tap 3 is
			// moved onto the Close button, which is tapped by id.
			expect(performed[0]).toMatchObject({ kind: "tap", x: 50, y: 150 });
			expect(performed[1]).toMatchObject({ kind: "tap", x: 50, y: 150 });
			expect(performed[2]).toMatchObject({ kind: "tap", id: "close" });
			expect(JSON.stringify(steps[2]?.action)).toContain('"snappedTo":"close"');
			expect(JSON.stringify(steps[1]?.action)).not.toContain("snappedTo");
		});

		it("lets a label tap read the tree itself when the step did not (vision and Grid mode)", async () => {
			const png = plainPng(255);
			const run = async (extra: { screenMode?: "tree"; appContext?: string }) => {
				const seen: Array<ScreenElement[] | undefined> = [];
				let calls = 0;
				await executeAgentCase({
					catalogCase: emptyCase(),
					appContext: extra.appContext ?? "Rewards app",
					screenMode: extra.screenMode,
					auth: fakeAuth(),
					session: {
						screenshot: async () => ({ path: "/tmp/same.png", base64: png }),
					} as unknown as DeviceSession,
					isAborted: () => false,
					appendStep: async () => {},
					readScreen: async () => ({
						elements: [
							{
								type: "Button",
								label: "Allow",
								id: "Allow",
								x: 400,
								y: 640,
								width: 200,
								height: 80,
							},
						],
					}),
					decide: async () => {
						calls += 1;
						return calls === 1
							? {
									type: "tap",
									label: "Allow",
									reason: "Dismiss the tracking dialog",
									thoughts: "System dialog",
								}
							: { type: "done", reason: "done", thoughts: "Finished" };
					},
					verify: async () => ({ type: "continue", reason: "Not done", thoughts: "Still here" }),
					performAction: async (_session, body, options) => {
						seen.push(options?.screenElements);
						return { ok: true, kind: body.kind };
					},
					clock: { sleep: async () => {}, now: () => 1 },
					settleMs: 0,
				});
				return seen;
			};

			// No tree was read, so no list may be passed: an empty one makes every label "not found".
			expect(await run({})).toEqual([undefined]);
			expect(await run({ appContext: "This is a mobile game." })).toEqual([undefined]);
			// Tree mode did read it, and that list is reused.
			const tree = await run({ screenMode: "tree" });
			expect(tree[0]?.[0]?.label).toBe("Allow");
		});

		it("hints when the same spot is tapped twice with no change, and not for different spots", async () => {
			const png = plainPng(255);
			const run = async (plan: AgentDecision[]) => {
				const errors: Array<string | undefined> = [];
				let calls = 0;
				await executeAgentCase({
					catalogCase: emptyCase(),
					appContext: "Rewards app",
					auth: fakeAuth(),
					session: {
						screenshot: async () => ({ path: "/tmp/same.png", base64: png }),
					} as unknown as DeviceSession,
					isAborted: () => false,
					appendStep: async () => {},
					decide: async (input) => {
						errors.push(input.lastError);
						const next = plan[calls];
						calls += 1;
						return next ?? { type: "done", reason: "done", thoughts: "Finished" };
					},
					verify: async () => ({ type: "continue", reason: "Not done", thoughts: "Still here" }),
					performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
					clock: { sleep: async () => {}, now: () => 1 },
					settleMs: 0,
				});
				return errors;
			};

			const same = await run([tapAt(50, 150), tapAt(50, 150), tapAt(52, 148)]);
			expect(same[0]).toBeUndefined();
			expect(same[1]).toBeUndefined();
			expect(same[2]).toContain("tapped 50,150 2 times");
			expect(same[2]).toContain("Do not tap it again");

			const apart = await run([tapAt(100, 100), tapAt(700, 700), tapAt(100, 700)]);
			expect(apart.some((error) => error?.includes("screen did not change"))).toBe(false);
		});

		it("tree mode never escalates on unchanged taps", async () => {
			const grids: boolean[] = [];
			const png = plainPng(255);
			let calls = 0;

			await executeAgentCase({
				catalogCase: emptyCase(),
				appContext: "Rewards app",
				auth: fakeAuth(),
				screenMode: "tree",
				session: {
					screenshot: async () => ({ path: "/tmp/same.png", base64: png }),
				} as unknown as DeviceSession,
				isAborted: () => false,
				appendStep: async () => {},
				readScreen: async () => ({
					elements: [
						{ type: "Button", label: "A", id: "a", x: 100, y: 100, width: 200, height: 80 },
						{ type: "Button", label: "B", id: "b", x: 100, y: 200, width: 200, height: 80 },
						{ type: "Button", label: "C", id: "c", x: 100, y: 300, width: 200, height: 80 },
					],
				}),
				decide: async (input) => {
					calls += 1;
					grids.push(input.coordGrid === true);
					if (calls <= 4) return tapAt(500, 500);
					return { type: "done", reason: "done", thoughts: "Finished" };
				},
				verify: async () => ({ type: "continue", reason: "Not done", thoughts: "Still here" }),
				performAction: async (_session, body) => ({ ok: true, kind: body.kind }),
				clock: { sleep: async () => {}, now: () => 1 },
				settleMs: 0,
			});

			expect(grids.every((grid) => grid === false)).toBe(true);
		});
	});
});
