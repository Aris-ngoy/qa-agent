import {
	type CaseScriptAction,
	type ScreenElement,
	caseScriptFileLinesFromShell,
	formatCaseScriptFileActionLine,
	parseCaseScriptFile,
} from "@yoqa/runner-client";

/** A comment line inside `actions:`, so it groups the steps after it. */
export function commentLine(text: string): string {
	return `  # ${text}`;
}

export function swipeLines(direction: "up" | "down" | "left" | "right"): string[] {
	return [
		commentLine(`swipe ${direction}`),
		formatCaseScriptFileActionLine(swipeAction(direction)),
	];
}

export function waitLine(seconds: number): string {
	return formatCaseScriptFileActionLine({ type: "wait", ms: Math.round(seconds * 1000) });
}

/**
 * Case Script file lines for `yoqa` shell lines from the element action dialog.
 * The dialog builds terminal commands; the editor holds a Case Script file.
 */
export function caseScriptLinesFromShell(
	lines: string[],
	elements: ScreenElement[] | undefined,
): { lines: string[]; actions: CaseScriptAction[]; warnings: string[] } {
	const converted = caseScriptFileLinesFromShell(lines.join("\n"), { elements });
	const actions: CaseScriptAction[] = [];
	if (converted.actionCount > 0) {
		const parsed = parseCaseScriptFile(`version: 1\nactions:\n${converted.lines.join("\n")}\n`);
		if (parsed.ok) actions.push(...parsed.script.actions);
	}
	return { lines: converted.lines, actions, warnings: converted.warnings };
}

/** True when the editor holds at least one valid action. */
export function scriptHasBody(script: string): boolean {
	const parsed = parseCaseScriptFile(script, { allowEmpty: true });
	return parsed.ok && parsed.script.actions.length > 0;
}

export function defaultCaseNameFromScript(script: string): string {
	const parsed = parseCaseScriptFile(script, { allowEmpty: true });
	if (parsed.ok && parsed.name) return parsed.name;
	for (const line of script.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#")) {
			const label = trimmed.replace(/^#+\s*/, "").trim();
			if (label.length > 0 && label.length <= 80) return label;
		}
	}
	const stamp = new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date());
	return `Inspector script · ${stamp}`;
}

function swipeAction(direction: "up" | "down" | "left" | "right"): CaseScriptAction {
	const mid = 500;
	const near = 200;
	const far = 800;
	switch (direction) {
		case "up":
			return { type: "swipe", x: mid, y: far, x2: mid, y2: near };
		case "down":
			return { type: "swipe", x: mid, y: near, x2: mid, y2: far };
		case "left":
			return { type: "swipe", x: far, y: mid, x2: near, y2: mid };
		case "right":
			return { type: "swipe", x: near, y: mid, x2: far, y2: mid };
	}
}
