import { TypeSafeClient, noul } from "@typesafe-ai/sdk";
import {
	JEV_DEFAULT_MODEL,
	JEV_EXPECTED_VISIBLE,
	JEV_INSTRUCTION_COMPLETE,
	JEV_STILL_BLOCKED,
	type JevNoulScores,
	composeInstructionVerdict,
	mergeJevModelCatalog,
} from "../jev-judge";
import type { DriverDefinition, DriverValidateInput, JudgePort } from "./types";

export function resolveJevKey(input: {
	apiKey: string | null;
	env: Record<string, string>;
}): string | null {
	return (
		input.apiKey?.trim() ||
		input.env.TYPESAFE_API_KEY?.trim() ||
		process.env.TYPESAFE_API_KEY?.trim() ||
		null
	);
}

function resolveJevBaseURL(baseUrl: string | null | undefined): string | undefined {
	const trimmed = baseUrl?.trim().replace(/\/$/, "");
	return trimmed || undefined;
}

export function createJevClient(input: {
	apiKey: string;
	baseUrl?: string | null;
	defaultModel?: string | null;
	fetch?: TypeSafeClient["fetch"];
}): TypeSafeClient {
	return new TypeSafeClient({
		apiKey: input.apiKey,
		baseURL: resolveJevBaseURL(input.baseUrl),
		defaultModel: input.defaultModel?.trim() || JEV_DEFAULT_MODEL,
		fetch: input.fetch,
		logLevel: "error",
	});
}

function clientFromValidate(input: DriverValidateInput): TypeSafeClient | null {
	const apiKey = resolveJevKey(input);
	if (!apiKey) return null;
	return createJevClient({ apiKey, baseUrl: input.baseUrl });
}

const jevJudge: JudgePort = {
	async confirmInstruction(input) {
		const apiKey = resolveJevKey(input.auth);
		if (!apiKey) {
			throw new Error("Jev provider has no TYPESAFE_API_KEY");
		}
		const client = createJevClient({
			apiKey,
			baseUrl: input.auth.baseUrl,
			defaultModel: input.auth.defaultModel,
		});
		const hasExpected = Boolean(input.expectedResult.trim());
		const state = {
			instruction: input.instruction,
			expected_result: input.expectedResult.trim() || "(none)",
			screen: input.screenSnapshot.trim() || "(unavailable)",
			recent_actions: input.recentActions.map((action) => ({
				type: action.type,
				reason: action.reason ?? "",
			})),
			vision_claim: {
				proposed: input.proposed,
				reason: input.proposedReason,
				thoughts: input.proposedThoughts,
			},
		};
		const { answers } = await client.systemOne({
			model: input.auth.defaultModel?.trim() || JEV_DEFAULT_MODEL,
			state,
			questions: {
				instruction_complete: noul(JEV_INSTRUCTION_COMPLETE),
				expected_visible: noul(JEV_EXPECTED_VISIBLE),
				still_blocked: noul(JEV_STILL_BLOCKED),
			},
		});
		const scores: JevNoulScores = {
			instructionComplete: answers.instruction_complete.noul,
			expectedVisible: hasExpected ? answers.expected_visible.noul : 1,
			stillBlocked: answers.still_blocked.noul,
		};
		return {
			...composeInstructionVerdict({
				proposed: input.proposed,
				hasExpected,
				scores,
			}),
			scores,
		};
	},
};

export const jevDriver: DriverDefinition = {
	kind: "jev",
	label: "Jev",
	description:
		"TypeSafe System One (Jev). Structured judge for verify/done/fail from the accessibility tree. Pair with a vision provider for taps.",
	defaultBinary: null,
	authModes: ["api_key"],
	envHints: ["TYPESAFE_API_KEY"],
	loginInstructions: "Create a key at https://console.typesafe.ai/settings/keys",
	capabilities: { vision: false, judge: true },
	judge: jevJudge,
	async probe() {
		return {
			found: true,
			version: null,
			authenticated: null,
			detail: "API key provider — no CLI required",
			binaryPath: null,
		};
	},
	async validate(input) {
		const client = clientFromValidate(input);
		if (!client) {
			return {
				ok: false,
				status: "invalid",
				message: "TypeSafe API key is required (TYPESAFE_API_KEY)",
			};
		}
		try {
			const models = await client.models.list();
			const count = models.length;
			return {
				ok: true,
				status: "connected",
				message: count > 0 ? `${count} Jev models available` : "Connected to TypeSafe",
			};
		} catch (error) {
			return {
				ok: false,
				status: "invalid",
				message: error instanceof Error ? error.message : "TypeSafe validation failed",
			};
		}
	},
	async listModels(input) {
		const client = clientFromValidate(input);
		if (!client) {
			return { models: [], message: "API key required to list Jev models" };
		}
		try {
			const cards = await client.models.list();
			const models = mergeJevModelCatalog(cards);
			return {
				models,
				message: `${models.length} models available`,
			};
		} catch (error) {
			return {
				models: [],
				message: error instanceof Error ? error.message : "Failed to list Jev models",
			};
		}
	},
};
