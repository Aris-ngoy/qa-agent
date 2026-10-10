import { type ShellScriptStep, parseYoqaShellScript, tokenizeShellLine } from "@yoqa/runner-client";

export type StepStatus = "passed" | "running" | "queued" | "idle";

export type ScriptStepRow = {
	lineNumber: number;
	/** 1-based position among runnable steps. */
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
	errors: Array<{ lineNumber: number; message: string }>;
};

function flag(tokens: string[], name: string): string | null {
	const at = tokens.indexOf(name);
	return at >= 0 ? (tokens[at + 1] ?? null) : null;
}

function capitalise(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function describeStep(step: ShellScriptStep): Pick<ScriptStepRow, "verb" | "text" | "meta"> {
	switch (step.kind) {
		case "sleep":
			return { verb: "Wait", text: `${step.seconds} s`, meta: "" };
		case "screenshot":
			return { verb: "Screenshot", text: step.path ?? "", meta: "" };
		case "assert":
			return {
				verb: "Assert",
				text: `“${step.text}” is ${step.assertion === "visible" ? "visible" : "not visible"}`,
				meta: "",
			};
		case "action": {
			const tokens = tokenizeShellLine(step.raw);
			const target = flag(tokens, "--label") ?? flag(tokens, "--id") ?? flag(tokens, "--text");
			const x = flag(tokens, "--x");
			const y = flag(tokens, "--y");
			return {
				verb: capitalise(step.action.kind),
				text: target ? `“${target}”` : "",
				meta: x != null && y != null ? `${x}, ${y}` : "",
			};
		}
	}
}

/**
 * Read-only structured view of a script: comment lines become group headings,
 * runnable lines become steps. While a run is in flight the active line splits
 * steps into passed (before) / running / queued (after).
 */
export function buildScriptStepsView(
	script: string,
	activeLineNumber: number | null,
	running: boolean,
): ScriptStepsView {
	const parsed = parseYoqaShellScript(script);
	const lines = script.split(/\r?\n/);
	const groups: ScriptStepsView["groups"] = [];
	lines.forEach((line, i) => {
		const trimmed = line.trim();
		// Skip the shebang and the header boilerplate comments before the first step.
		if (!trimmed.startsWith("#") || trimmed.startsWith("#!")) return;
		const text = trimmed.replace(/^#+\s*/, "");
		if (text) groups.push({ beforeLineNumber: i + 1, text });
	});
	const firstStepLine = parsed.steps[0]?.lineNumber ?? Number.POSITIVE_INFINITY;
	const steps = parsed.steps.map((step, i): ScriptStepRow => {
		let status: StepStatus = "idle";
		if (running && activeLineNumber != null) {
			status =
				step.lineNumber < activeLineNumber
					? "passed"
					: step.lineNumber === activeLineNumber
						? "running"
						: "queued";
		}
		return { lineNumber: step.lineNumber, index: i + 1, ...describeStep(step), status };
	});
	return {
		groups: groups.filter((group) => group.beforeLineNumber > firstStepLine),
		steps,
		errors: parsed.errors.map(({ lineNumber, message }) => ({ lineNumber, message })),
	};
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
