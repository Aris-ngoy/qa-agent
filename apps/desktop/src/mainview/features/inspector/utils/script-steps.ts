import { type CaseScriptAction, formatKeyChord, parseCaseScriptFile } from "@yoqa/runner-client";

export type StepStatus = "passed" | "running" | "queued" | "idle";

export type ScriptStepRow = {
	lineNumber: number;
	/** 1-based position among the Case Script's actions. */
	index: number;
	verb: string;
	text: string;
	meta: string;
	status: StepStatus;
};

export type ScriptStepsView = {
	/** Comment headings by the line they precede, so the list can group steps. */
	groups: Array<{ beforeLineNumber: number; text: string }>;
	steps: ScriptStepRow[];
	errors: Array<{ lineNumber: number | null; message: string }>;
};

const VERBS: Record<CaseScriptAction["type"], string> = {
	tap: "Tap",
	swipe: "Swipe",
	drag: "Drag",
	type: "Type",
	wait: "Wait",
	assert: "Assert",
	alert: "Alert",
	"activate-app": "Activate app",
	"terminate-app": "Terminate app",
	"restart-app": "Restart app",
	"background-app": "Background app",
	"open-url": "Open URL",
	key: "Press",
};

function describeAction(action: CaseScriptAction): Pick<ScriptStepRow, "verb" | "text" | "meta"> {
	const verb =
		action.type === "tap" && action.durationMs != null ? "Long press" : VERBS[action.type];
	switch (action.type) {
		case "tap": {
			const target = action.label ?? action.id;
			return {
				verb: action.double ? "Double tap" : verb,
				text: target ? `“${target}”` : "",
				meta: action.x != null && action.y != null ? `${action.x}, ${action.y}` : "",
			};
		}
		case "swipe":
		case "drag":
			return { verb, text: "", meta: `${action.x}, ${action.y} → ${action.x2}, ${action.y2}` };
		case "type":
			return { verb, text: `“${action.text}”`, meta: "" };
		case "wait":
			return { verb, text: `${action.ms / 1000} s`, meta: "" };
		case "assert":
			return {
				verb,
				text: `“${action.text}” is ${action.assertion === "visible" ? "visible" : "not visible"}`,
				meta: "",
			};
		case "alert":
			return { verb, text: action.alertAction === "dismiss" ? "Dismiss" : "Accept", meta: "" };
		case "activate-app":
		case "terminate-app":
		case "restart-app":
			return { verb, text: action.appId, meta: "" };
		case "background-app":
			return { verb, text: action.seconds != null ? `${action.seconds} s` : "", meta: "" };
		case "open-url":
			return { verb, text: action.url, meta: "" };
		case "key":
			return { verb, text: formatKeyChord(action.key, action.modifiers), meta: "" };
	}
}

/**
 * Read-only structured view of the editor's Case Script file: comment lines inside
 * `actions:` become group headings, actions become steps. While a run is in flight the
 * active line splits steps into passed (before) / running / queued (after).
 */
export function buildScriptStepsView(
	script: string,
	activeLineNumber: number | null,
	running: boolean,
): ScriptStepsView {
	const parsed = parseCaseScriptFile(script, { allowEmpty: true });
	if (!parsed.ok) {
		return {
			groups: [],
			steps: [],
			errors: parsed.errors.map(({ line, action, message }) => ({
				lineNumber: line,
				message: action != null ? `action ${action}: ${message}` : message,
			})),
		};
	}
	const firstStepLine = parsed.actionLines[0] ?? Number.POSITIVE_INFINITY;
	const groups: ScriptStepsView["groups"] = [];
	script.split(/\r?\n/).forEach((line, i) => {
		const trimmed = line.trim();
		if (!trimmed.startsWith("#")) return;
		const text = trimmed.replace(/^#+\s*/, "");
		if (text && i + 1 > firstStepLine) groups.push({ beforeLineNumber: i + 1, text });
	});
	const steps = parsed.script.actions.map((action, i): ScriptStepRow => {
		const lineNumber = parsed.actionLines[i] ?? 0;
		let status: StepStatus = "idle";
		if (running && activeLineNumber != null) {
			status =
				lineNumber < activeLineNumber
					? "passed"
					: lineNumber === activeLineNumber
						? "running"
						: "queued";
		}
		return { lineNumber, index: i + 1, ...describeAction(action), status };
	});
	return { groups, steps, errors: [] };
}

export function runProgress(view: ScriptStepsView): {
	total: number;
	passed: number;
	currentIndex: number | null;
} {
	const passed = view.steps.filter((step) => step.status === "passed").length;
	const current = view.steps.find((step) => step.status === "running");
	return { total: view.steps.length, passed, currentIndex: current?.index ?? null };
}
