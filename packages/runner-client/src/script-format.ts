import { caseScriptActionCommand } from "./case-script-replay";
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
	if (action.type === "key") {
		return action.modifiers?.length
			? `yoqa action key ${action.key} --modifiers ${action.modifiers.join(",")}`
			: `yoqa action key ${action.key}`;
	}
	if (action.type === "branch") {
		const check = caseScriptActionCommand(action);
		const side = (actions: CaseScriptAction[]) =>
			actions.map((inner) => indentLines(actionToShellLine(inner)));
		return [
			`if ${BRANCH_HELPER} ${check}; then`,
			...side(action.then),
			...(action.else?.length ? ["else", ...side(action.else)] : []),
			"fi",
		].join("\n");
	}
	const seconds = Math.max(0.1, action.ms / 1000);
	return `sleep ${seconds}`;
}

/** The shell function an exported Branch runs its `yoqa assert` through. */
const BRANCH_HELPER = "yoqa_branch";

/**
 * Defined once, above the actions, when the script has a Branch. `yoqa assert` exits 0 for
 * `then` and 1 for `else`; any other status means it could not check the Screen, and the
 * script stops there, as a Run would fail the case, instead of taking `else`.
 */
const BRANCH_HELPER_LINES = [
	"# A Branch's check: 0 runs `then`, 1 runs `else`, anything else stops the script.",
	`${BRANCH_HELPER}() {`,
	"  local status=0",
	'  "$@" || status=$?',
	'  [ "$status" -le 1 ] || exit "$status"',
	'  return "$status"',
	"}",
	"",
];

function indentLines(text: string): string {
	return text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
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
		"# Prefer the Case Script file: `yoqa script run <file.yoqa.yaml>`.",
		"set -euo pipefail",
		"",
		// A nested Branch sits inside a top-level one, so the top level is enough to look at.
		...(script.actions.some((action) => action.type === "branch") ? BRANCH_HELPER_LINES : []),
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
