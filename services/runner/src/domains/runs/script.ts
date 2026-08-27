import { type CaseScript, type CaseScriptAction, caseScriptSchema } from "@yoqa/runner-client";
import type { AgentDecision } from "./agent";

/** Build a replayable script from successful agent decisions (tap/type/wait/alert). */
export function buildScriptFromDecisions(
	decisions: AgentDecision[],
	sourceRunId: string,
): CaseScript | null {
	const actions: CaseScriptAction[] = [];
	for (const decision of decisions) {
		if (decision.type === "tap") {
			if (decision.label) {
				actions.push({
					type: "tap",
					label: decision.label,
					reason: decision.reason,
				});
			} else if (decision.id) {
				actions.push({
					type: "tap",
					id: decision.id,
					reason: decision.reason,
				});
			} else {
				actions.push({
					type: "tap",
					x: decision.x ?? 500,
					y: decision.y ?? 500,
					reason: decision.reason,
				});
			}
		} else if (decision.type === "type") {
			actions.push({
				type: "type",
				text: decision.text ?? "",
				reason: decision.reason,
			});
		} else if (decision.type === "wait") {
			actions.push({
				type: "wait",
				ms: Math.min(3000, Math.max(500, decision.ms ?? 1500)),
				reason: decision.reason,
			});
		} else if (decision.type === "alert") {
			actions.push({
				type: "alert",
				alertAction: decision.alertAction === "dismiss" ? "dismiss" : "accept",
				reason: decision.reason,
			});
		}
	}
	if (actions.length === 0) return null;
	return {
		version: 1,
		sourceRunId,
		savedAt: Date.now(),
		actions,
	};
}

export function parseCaseScript(raw: string | null | undefined): CaseScript | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		const result = caseScriptSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

export function serializeCaseScript(script: CaseScript): string {
	return JSON.stringify(script);
}
