import {
	type ActionRequest,
	DEFAULT_SHELL_SCRIPT_HEADER,
	formatActionShellLine,
	formatSleepShellLine,
} from "@yoqa/runner-client";

export function swipeLines(direction: "up" | "down" | "left" | "right"): string[] {
	return [`# swipe ${direction}`, formatActionShellLine(swipeAction(direction))];
}

export function waitLine(seconds: number): string {
	return formatSleepShellLine(seconds);
}

export function miniScriptFromLines(lines: string[]): string {
	return `${DEFAULT_SHELL_SCRIPT_HEADER}\n${lines.join("\n")}\n`;
}

export function scriptHasBody(script: string): boolean {
	return script.split(/\r?\n/).some((line) => {
		const t = line.trim();
		return t.length > 0 && !t.startsWith("#") && t !== "set -euo pipefail";
	});
}

export function defaultCaseNameFromScript(script: string): string {
	for (const line of script.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed.startsWith("#") && !trimmed.startsWith("#!") && !trimmed.includes("Yoqa")) {
			const label = trimmed.replace(/^#\s*/, "").trim();
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

function swipeAction(direction: "up" | "down" | "left" | "right"): ActionRequest {
	const mid = 500;
	const near = 200;
	const far = 800;
	switch (direction) {
		case "up":
			return { kind: "swipe", x: mid, y: far, x2: mid, y2: near };
		case "down":
			return { kind: "swipe", x: mid, y: near, x2: mid, y2: far };
		case "left":
			return { kind: "swipe", x: far, y: mid, x2: near, y2: mid };
		case "right":
			return { kind: "swipe", x: near, y: mid, x2: far, y2: mid };
	}
}
