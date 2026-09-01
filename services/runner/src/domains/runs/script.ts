import { type CaseScript, type CaseScriptAction, caseScriptSchema } from "@yoqa/runner-client";
import { type AgentDecision, prefersScreenshotTap, resolveSwipeNorm } from "./agent";

/** Build a replayable script from successful agent decisions (tap/swipe/type/wait/alert). */
export function buildScriptFromDecisions(
	decisions: AgentDecision[],
	sourceRunId: string,
): CaseScript | null {
	const actions: CaseScriptAction[] = [];
	for (const decision of decisions) {
		if (decision.type === "tap") {
			if (prefersScreenshotTap(decision)) {
				actions.push({
					type: "tap",
					x: decision.x,
					y: decision.y,
					...(decision.double ? { double: true } : {}),
					...(decision.durationMs != null ? { durationMs: decision.durationMs } : {}),
					reason: decision.reason,
				});
			} else if (decision.label) {
				actions.push({
					type: "tap",
					label: decision.label,
					...(decision.double ? { double: true } : {}),
					...(decision.durationMs != null ? { durationMs: decision.durationMs } : {}),
					reason: decision.reason,
				});
			} else if (decision.id) {
				actions.push({
					type: "tap",
					id: decision.id,
					...(decision.double ? { double: true } : {}),
					...(decision.durationMs != null ? { durationMs: decision.durationMs } : {}),
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
		} else if (decision.type === "swipe") {
			const swipe = resolveSwipeNorm(decision);
			if (!swipe) continue;
			actions.push({
				type: "swipe",
				x: swipe.x,
				y: swipe.y,
				x2: swipe.x2,
				y2: swipe.y2,
				...(decision.durationMs != null ? { durationMs: decision.durationMs } : {}),
				reason: decision.reason,
			});
		} else if (decision.type === "type" || decision.type === "input") {
			actions.push({
				type: "type",
				text: decision.text ?? "",
				reason: decision.reason,
			});
		} else if (decision.type === "drag") {
			if (decision.x == null || decision.y == null || decision.x2 == null || decision.y2 == null) {
				continue;
			}
			actions.push({
				type: "drag",
				x: decision.x,
				y: decision.y,
				x2: decision.x2,
				y2: decision.y2,
				...(decision.durationMs != null ? { durationMs: decision.durationMs } : {}),
				reason: decision.reason,
			});
		} else if (
			decision.type === "activate-app" ||
			decision.type === "terminate-app" ||
			decision.type === "restart-app"
		) {
			if (!decision.appId) continue;
			actions.push({
				type: decision.type,
				appId: decision.appId,
				reason: decision.reason,
			});
		} else if (decision.type === "background-app") {
			actions.push({
				type: "background-app",
				...(decision.seconds != null ? { seconds: decision.seconds } : {}),
				reason: decision.reason,
			});
		} else if (decision.type === "open-url") {
			if (!decision.url) continue;
			actions.push({
				type: "open-url",
				url: decision.url,
				reason: decision.reason,
			});
		} else if (decision.type === "assert") {
			if (!decision.text?.trim()) continue;
			actions.push({
				type: "assert",
				assertion: decision.assertion === "not-visible" ? "not-visible" : "visible",
				text: decision.text,
				...(decision.timeoutMs != null ? { timeoutMs: decision.timeoutMs } : {}),
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
