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
});
