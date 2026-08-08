import type { CaseScript, CaseScriptAction } from "./schemas";

export type CaseScriptExportMeta = {
	caseNumber?: number;
	caseName?: string;
	appPrefix?: string;
};

function shellSingleQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function actionToShellLine(action: CaseScriptAction): string {
	if (action.type === "tap") {
		return `yoqa action tap --x ${Math.round(action.x)} --y ${Math.round(action.y)}`;
	}
	if (action.type === "type") {
		return `yoqa action input --text ${shellSingleQuote(action.text)}`;
	}
	const seconds = Math.max(0.1, action.ms / 1000);
	return `sleep ${seconds}`;
}

/** Pretty-printed CaseScript JSON for viewing / `yoqa script run`. */
export function formatCaseScriptJson(script: CaseScript): string {
	return `${JSON.stringify(script, null, 2)}\n`;
}

/** Bash script that replays via `yoqa action` + `sleep` on an active device session. */
export function formatCaseScriptShell(script: CaseScript, meta: CaseScriptExportMeta = {}): string {
	const titleParts = [
		meta.caseNumber != null ? `#${meta.caseNumber}` : null,
		meta.caseName?.trim() || null,
	].filter(Boolean);
	const title = titleParts.length > 0 ? titleParts.join(" ") : "exported script";
	const lines = [
		"#!/usr/bin/env bash",
		`# Yoqa exported script — ${title}`,
		"# Requires an active device session: yoqa devices connect <id>",
		"# Prefer JSON + `yoqa script run <file.yoqa.json>` for structured replay.",
		"set -euo pipefail",
		"",
		...script.actions.map(actionToShellLine),
		"",
	];
	return lines.join("\n");
}

export function suggestedScriptBasename(meta: CaseScriptExportMeta = {}): string {
	const raw = [
		meta.appPrefix,
		meta.caseNumber != null ? String(meta.caseNumber) : null,
		meta.caseName,
	]
		.filter(Boolean)
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return raw || "yoqa-script";
}
