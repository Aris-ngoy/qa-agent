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
		const parts = ["yoqa", "action", "tap"];
		if (action.label) {
			parts.push("--label", shellSingleQuote(action.label));
		} else if (action.id) {
			parts.push("--id", shellSingleQuote(action.id));
		} else {
			parts.push(
				"--x",
				String(Math.round(action.x ?? 0)),
				"--y",
				String(Math.round(action.y ?? 0)),
			);
		}
		if (action.double) parts.push("--double");
		if (action.durationMs != null) parts.push("--duration", String(Math.round(action.durationMs)));
		return parts.join(" ");
	}
	if (action.type === "swipe") {
		const parts = [
			"yoqa",
			"action",
			"swipe",
			"--x",
			String(Math.round(action.x)),
			"--y",
			String(Math.round(action.y)),
			"--x2",
			String(Math.round(action.x2)),
			"--y2",
			String(Math.round(action.y2)),
		];
		if (action.durationMs != null) {
			parts.push("--duration", String(Math.round(action.durationMs)));
		}
		return parts.join(" ");
	}
	if (action.type === "drag") {
		const parts = [
			"yoqa",
			"action",
			"drag",
			"--x",
			String(Math.round(action.x)),
			"--y",
			String(Math.round(action.y)),
			"--x2",
			String(Math.round(action.x2)),
			"--y2",
			String(Math.round(action.y2)),
		];
		if (action.durationMs != null) {
			parts.push("--duration", String(Math.round(action.durationMs)));
		}
		return parts.join(" ");
	}
	if (action.type === "type") {
		return `yoqa action input --text ${shellSingleQuote(action.text)}`;
	}
	if (action.type === "assert") {
		const timeoutSeconds =
			action.timeoutMs != null ? Math.max(1, Math.round(action.timeoutMs / 1000)) : undefined;
		const parts = ["yoqa", "assert", action.assertion, "--text", shellSingleQuote(action.text)];
		if (timeoutSeconds != null) {
			parts.push("--timeout", String(timeoutSeconds));
		}
		return parts.join(" ");
	}
	if (action.type === "alert") {
		return action.alertAction === "dismiss" ? "yoqa action alert --dismiss" : "yoqa action alert";
	}
	if (
		action.type === "activate-app" ||
		action.type === "terminate-app" ||
		action.type === "restart-app"
	) {
		return `yoqa action ${action.type} --app-id ${shellSingleQuote(action.appId)}`;
	}
	if (action.type === "background-app") {
		return action.seconds != null
			? `yoqa action background-app --seconds ${action.seconds}`
			: "yoqa action background-app";
	}
	if (action.type === "open-url") {
		return `yoqa action open-url --url ${shellSingleQuote(action.url)}`;
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
