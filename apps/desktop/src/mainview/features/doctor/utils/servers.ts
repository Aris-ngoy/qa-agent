import type { ServerEntry } from "@yoqa/runner-client";

export function kindBadge(kind: ServerEntry["kind"]): string {
	if (kind === "runner") return "Runner";
	return "Session";
}

export function ownershipHint(entry: ServerEntry): string {
	if (entry.ownership === "foreign") return "foreign";
	if (entry.ownership === "self") return "self";
	return "managed";
}

export function canActViaHttp(entry: ServerEntry, action: "stop" | "restart"): boolean {
	return entry.actions.includes(action);
}

export function isRunnerRow(entry: ServerEntry): boolean {
	return entry.kind === "runner";
}
