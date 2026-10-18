import { describe, expect, test } from "bun:test";
import {
	caseScriptFileLinesFromShell,
	emptyCaseScriptFile,
	formatCaseScriptFile,
	formatCaseScriptFileAction,
	formatCaseScriptFileErrors,
	looksLikeShellScript,
	parseCaseScriptFile,
	toCaseScriptFileText,
} from "./case-script-file";
import { type CaseScript, type CaseScriptAction, caseScriptActionSchema } from "./schemas";
import { formatCaseScriptShell } from "./script-format";

const BOTTOM_NAV = `version: 1
name: Bottom navigation
actions:
  - restart-app: com.example.app
  - tap: Home
  - tap: { label: Search, x: 500, y: 930 }
  - tap: { x: 120, y: 940, durationMs: 800 }
  - swipe: { x: 500, y: 800, x2: 500, y2: 200 }
  - drag: { x: 100, y: 100, x2: 900, y2: 100, durationMs: 600 }
  - type: hello
  - wait: 500
  - assert: Welcome
  - assert: { text: Error, assertion: not-visible, timeoutMs: 3000 }
  - alert: dismiss
  - activate-app: com.example.app
  - terminate-app: com.example.app
  - background-app: 3
  - open-url: myapp://settings
  - key: Enter
  - key: { key: Tab, modifiers: [Shift] }
`;

function parseOk(text: string) {
	const result = parseCaseScriptFile(text, { savedAt: 1 });
	if (!result.ok) throw new Error(formatCaseScriptFileErrors(result.errors));
	return result;
}

function errorsOf(text: string) {
	const result = parseCaseScriptFile(text, { savedAt: 1 });
	if (result.ok) throw new Error("expected errors");
	return result.errors;
}

describe("parseCaseScriptFile", () => {
	test("reads every action type, short and long forms", () => {
		const parsed = parseOk(BOTTOM_NAV);
		expect(parsed.name).toBe("Bottom navigation");
		expect(parsed.script.savedAt).toBe(1);
		expect(parsed.script.actions).toEqual([
			{ type: "restart-app", appId: "com.example.app" },
			{ type: "tap", label: "Home" },
			{ type: "tap", label: "Search", x: 500, y: 930 },
			{ type: "tap", x: 120, y: 940, durationMs: 800 },
			{ type: "swipe", x: 500, y: 800, x2: 500, y2: 200 },
			{ type: "drag", x: 100, y: 100, x2: 900, y2: 100, durationMs: 600 },
			{ type: "type", text: "hello" },
			{ type: "wait", ms: 500 },
			{ type: "assert", assertion: "visible", text: "Welcome" },
			{ type: "assert", assertion: "not-visible", text: "Error", timeoutMs: 3000 },
			{ type: "alert", alertAction: "dismiss" },
			{ type: "activate-app", appId: "com.example.app" },
			{ type: "terminate-app", appId: "com.example.app" },
			{ type: "background-app", seconds: 3 },
			{ type: "open-url", url: "myapp://settings" },
			{ type: "key", key: "Enter" },
			{ type: "key", key: "Tab", modifiers: ["Shift"] },
		]);
	});

	test("reports the line of each action", () => {
		const parsed = parseOk(`# header comment
version: 1
actions:
  # Open Home
  - tap: Home

  - wait: 200
`);
		expect(parsed.actionLines).toEqual([5, 7]);
	});

	test("reads a short-form number as text where the field is text", () => {
		const parsed = parseOk("version: 1\nactions:\n  - type: 1234\n  - tap: true\n");
		expect(parsed.script.actions).toEqual([
			{ type: "type", text: "1234" },
			{ type: "tap", label: "true" },
		]);
	});

	test("reads an empty background-app and alert as their defaults", () => {
		const parsed = parseOk("version: 1\nactions:\n  - background-app:\n  - alert: {}\n");
		expect(parsed.script.actions).toEqual([
			{ type: "background-app" },
			{ type: "alert", alertAction: "accept" },
		]);
	});

	test("reads a legacy .yoqa.json export, keeping savedAt and sourceRunId", () => {
		const legacy: CaseScript = {
			version: 1,
			sourceRunId: "run_1",
			savedAt: 42,
			actions: [
				{ type: "tap", x: 10, y: 20 },
				{ type: "type", text: "hi" },
				{ type: "alert", alertAction: "accept" },
			],
		};
		const parsed = parseOk(JSON.stringify(legacy, null, 2));
		expect(parsed.script).toEqual(legacy);
		expect(parsed.name).toBeNull();
	});

	test("reads a legacy single-field action by its type, not as a `type` action", () => {
		const parsed = parseOk(
			JSON.stringify({ version: 1, savedAt: 1, actions: [{ type: "alert" }] }),
		);
		expect(parsed.script.actions).toEqual([{ type: "alert", alertAction: "accept" }]);
	});

	test("accepts an empty action list only when asked", () => {
		const text = emptyCaseScriptFile("Draft");
		expect(errorsOf(text).map((e) => e.message)).toEqual(["actions: add at least one action"]);
		const draft = parseCaseScriptFile(text, { allowEmpty: true });
		expect(draft.ok && draft.script.actions).toEqual([]);
		expect(draft.ok && draft.name).toBe("Draft");
	});

	test("names the line and action of every problem", () => {
		const errors = errorsOf(`version: 1
actions:
  - tap: {}
  - tapp: x
  - tap: a
    wait: 2
  - wait: 20000
  - tap: { label: A, colour: red }
  - swipe: up
foo: 1
`);
		expect(formatCaseScriptFileErrors(errors)).toBe(
			[
				"Line 3, action 1: tap: tap requires x/y or label or id",
				'Line 4, action 2: unknown action "tapp" (expected one of: tap, swipe, drag, type, wait, assert, alert, activate-app, terminate-app, restart-app, background-app, open-url, key, if)',
				"Line 5, action 3: an action has exactly one key (its name); found tap, wait",
				"Line 7, action 4: wait: ms: Number must be less than or equal to 10000",
				'Line 8, action 5: tap: unknown field "colour" (allowed: x, y, label, id, double, durationMs, reason)',
				"Line 9, action 6: swipe has no short form; write it as a map of fields",
				'Line 10: unknown key "foo" (allowed: version, name, sourceRunId, savedAt, actions)',
			].join("\n"),
		);
	});

	test("reports malformed YAML with its line", () => {
		const errors = errorsOf("version: 1\nactions:\n  - tap: [\n");
		expect(errors).toHaveLength(1);
		expect(errors[0]?.line).toBe(4);
	});

	test("requires version 1", () => {
		expect(errorsOf("actions:\n  - tap: A\n").map((e) => e.message)).toEqual([
			"missing `version: 1`",
		]);
		expect(errorsOf("version: 2\nactions:\n  - tap: A\n")[0]).toEqual({
			line: 1,
			action: null,
			message: "unsupported version 2 (expected 1)",
		});
	});

	test("rejects a document that is not a map", () => {
		expect(errorsOf("- tap: Home\n")[0]?.message).toBe(
			"expected a Case Script with `version: 1` and `actions:`",
		);
	});
});

describe("formatCaseScriptFile", () => {
	test("writes one action per line with short forms and a stable key order", () => {
		const script: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "tap", x: 500, y: 930, label: "Search" },
				{ type: "tap", label: "Home" },
				{ type: "tap", id: "submit", double: true },
				{ type: "type", text: "1234" },
				{ type: "type", text: "line one\nline: two" },
				{ type: "wait", ms: 500 },
				{ type: "assert", assertion: "visible", text: "Welcome" },
				{ type: "assert", assertion: "visible", text: "Saved", timeoutMs: 2000 },
				{ type: "alert", alertAction: "accept" },
				{ type: "background-app" },
				{ type: "open-url", url: "myapp://a?b=c" },
			],
		};
		expect(formatCaseScriptFile(script, { name: "Checkout" })).toBe(`version: 1
name: Checkout
actions:
  - tap: { label: Search, x: 500, y: 930 }
  - tap: Home
  - tap: { id: submit, double: true }
  - type: "1234"
  - type: "line one\\nline: two"
  - wait: 500
  - assert: Welcome
  - assert: { text: Saved, timeoutMs: 2000 }
  - alert: accept
  - background-app: {}
  - open-url: myapp://a?b=c
`);
	});

	test("quotes text that would break a one-line action map", () => {
		const tricky = [
			"Hello, Ada",
			"a]b",
			"{q}",
			"x: y",
			"#tag",
			"a #b",
			"true",
			"1234",
			"",
			" lead",
		];
		const script: CaseScript = {
			version: 1,
			savedAt: 1,
			actions: tricky.flatMap((text): CaseScript["actions"] => [
				{ type: "type", text },
				{ type: "assert", assertion: "visible", text: text || "x", timeoutMs: 1000, reason: text },
			]),
		};
		const text = formatCaseScriptFile(script);
		expect(text).toContain(
			'  - assert: { text: "Hello, Ada", timeoutMs: 1000, reason: "Hello, Ada" }',
		);
		expect(text.split("\n")).toHaveLength(script.actions.length + 3);
		expect(parseOk(text).script).toEqual(script);
	});

	test("round-trips every action back to the same Case Script", () => {
		const first = parseOk(BOTTOM_NAV);
		const again = parseOk(formatCaseScriptFile(first.script, { name: first.name }));
		expect(again.script).toEqual(first.script);
		expect(again.name).toBe(first.name);
	});

	test("writes a key with modifiers as a flow list", () => {
		const text = formatCaseScriptFile({
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "key", key: "Escape" },
				{ type: "key", key: "ArrowDown", modifiers: ["Control", "Shift"] },
			],
		});
		expect(text).toContain("  - key: Escape\n");
		expect(text).toContain("  - key: { key: ArrowDown, modifiers: [Control, Shift] }\n");
		expect(parseOk(text).script.actions).toEqual([
			{ type: "key", key: "Escape" },
			{ type: "key", key: "ArrowDown", modifiers: ["Control", "Shift"] },
		]);
	});

	test("rejects a key outside the fixed set", () => {
		expect(errorsOf("version: 1\nactions:\n  - key: F5\n")[0]?.message).toContain("key: key:");
	});

	test("keeps sourceRunId and drops savedAt", () => {
		const text = formatCaseScriptFile({
			version: 1,
			sourceRunId: "run_9",
			savedAt: 99,
			actions: [{ type: "wait", ms: 100 }],
		});
		expect(text).toBe("version: 1\nsourceRunId: run_9\nactions:\n  - wait: 100\n");
	});
});

describe("legacy shell", () => {
	const SHELL = `#!/usr/bin/env bash
# Yoqa inspector script
# Requires an active device session: yoqa devices connect <id>
set -euo pipefail

# Tap "Home"
yoqa action tap --label 'Home'
sleep 1.5
yoqa screenshot
yoqa action input --text 'hi'
yoqa assert visible --text 'Done' --timeout 3
`;

	test("is recognised as shell, and YAML is not", () => {
		expect(looksLikeShellScript(SHELL)).toBe(true);
		expect(looksLikeShellScript("yoqa action tap --x 1 --y 2")).toBe(true);
		expect(looksLikeShellScript(BOTTOM_NAV)).toBe(false);
	});

	test("converts to a Case Script file, keeping comments and warning about what it drops", () => {
		const converted = toCaseScriptFileText(SHELL);
		expect(converted.text).toBe(`version: 1
actions:
  # Tap "Home"
  - tap: Home
  - wait: 1500
  - type: hi
  - assert: { text: Done, timeoutMs: 3000 }
`);
		expect(converted.warnings).toEqual(["L9: screenshot not supported in CaseScript — skipped"]);
		expect(converted.text && parseCaseScriptFile(converted.text).ok).toBe(true);
	});

	test("converts single inserted lines into action lines", () => {
		expect(
			caseScriptFileLinesFromShell(
				"# Swipe up\nyoqa action swipe --x 500 --y 800 --x2 500 --y2 200",
			),
		).toEqual({
			lines: ["  # Swipe up", "  - swipe: { x: 500, y: 800, x2: 500, y2: 200 }"],
			actionCount: 1,
			warnings: [],
		});
	});

	test("skips an exported Branch's bash `if` whole, with one warning, instead of flattening it", () => {
		const exported = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "tap", label: "Start" },
				{
					type: "branch",
					text: "Allow notifications",
					assertion: "visible",
					then: [
						{ type: "tap", label: "Allow" },
						{
							type: "branch",
							id: "promo",
							assertion: "visible",
							then: [{ type: "tap", label: "Close" }],
						},
					],
					else: [{ type: "wait", ms: 500 }],
				},
				{ type: "tap", label: "Home" },
			],
		});
		const converted = toCaseScriptFileText(exported);
		expect(converted.text).toBe("version: 1\nactions:\n  - tap: Start\n  - tap: Home\n");
		expect(converted.warnings).toEqual([
			"L8–L15: bash `if` is not converted to a Branch — skipped; write it as an `- if:` item",
		]);
	});

	test("rewrites a legacy JSON export as canonical YAML and keeps YAML as written", () => {
		const json = JSON.stringify({ version: 1, savedAt: 5, actions: [{ type: "tap", x: 1, y: 2 }] });
		expect(toCaseScriptFileText(json).text).toBe("version: 1\nactions:\n  - tap: { x: 1, y: 2 }\n");
		const commented = "version: 1\nactions:\n  # keep me\n  - tap: Home\n";
		expect(toCaseScriptFileText(commented).text).toBe(commented);
	});

	test("returns errors for an invalid file instead of text", () => {
		const result = toCaseScriptFileText("version: 1\nactions:\n  - nope: 1\n");
		expect(result.text).toBeNull();
		expect(result.errors[0]?.line).toBe(3);
	});
});

const BRANCHED = `version: 1
name: Onboarding
actions:
  - restart-app: com.example.app
  - if:
      text: Allow notifications
      timeoutMs: 3000
      then:
        - tap: Allow
      else:
        - wait: 500
  - if:
      text: Loading
      assertion: not-visible
      reason: Spinner gone
      then:
        - if:
            text: Welcome back
            then:
              - tap: Continue
              - type: hi
        - assert: Home
  - assert: Home
`;

describe("Branches", () => {
	test("reads `if:` items, nested, with and without `else`", () => {
		expect(parseOk(BRANCHED).script.actions).toEqual([
			{ type: "restart-app", appId: "com.example.app" },
			{
				type: "branch",
				text: "Allow notifications",
				assertion: "visible",
				timeoutMs: 3000,
				then: [{ type: "tap", label: "Allow" }],
				else: [{ type: "wait", ms: 500 }],
			},
			{
				type: "branch",
				text: "Loading",
				assertion: "not-visible",
				reason: "Spinner gone",
				then: [
					{
						type: "branch",
						text: "Welcome back",
						assertion: "visible",
						then: [
							{ type: "tap", label: "Continue" },
							{ type: "type", text: "hi" },
						],
					},
					{ type: "assert", assertion: "visible", text: "Home" },
				],
			},
			{ type: "assert", assertion: "visible", text: "Home" },
		]);
		expect(parseOk(BRANCHED).actionLines).toEqual([4, 5, 12, 23]);
	});

	test("exports block lists, one action per line, and re-imports unchanged", () => {
		const parsed = parseOk(BRANCHED);
		const text = formatCaseScriptFile(parsed.script, { name: parsed.name });
		expect(text).toBe(BRANCHED);
		expect(parseOk(text).script).toEqual(parsed.script);
		expect(formatCaseScriptFile(parseOk(text).script, { name: parsed.name })).toBe(text);
	});

	test("reads `label` as `text`, and an empty `else` as no `else`", () => {
		const parsed = parseOk(`version: 1
actions:
  - if: { label: Skip, then: [tap: Skip], else: [] }
`);
		expect(parsed.script.actions).toEqual([
			{
				type: "branch",
				text: "Skip",
				assertion: "visible",
				then: [{ type: "tap", label: "Skip" }],
			},
		]);
		expect(formatCaseScriptFile(parsed.script)).toBe(`version: 1
actions:
  - if:
      text: Skip
      then:
        - tap: Skip
`);
	});

	test("reads an `id:` target, and exports it back unchanged", () => {
		const text = `version: 1
actions:
  - if:
      id: onboarding-skip
      assertion: not-visible
      then:
        - if:
            id: allow-button
            timeoutMs: 500
            then:
              - tap: { id: allow-button }
      else:
        - tap: { id: onboarding-skip }
`;
		const parsed = parseOk(text);
		expect(parsed.script.actions).toEqual([
			{
				type: "branch",
				id: "onboarding-skip",
				assertion: "not-visible",
				then: [
					{
						type: "branch",
						id: "allow-button",
						assertion: "visible",
						timeoutMs: 500,
						then: [{ type: "tap", id: "allow-button" }],
					},
				],
				else: [{ type: "tap", id: "onboarding-skip" }],
			},
		]);
		expect(formatCaseScriptFile(parsed.script)).toBe(text);
		expect(formatCaseScriptFileAction(parsed.script.actions[0] as CaseScriptAction)).toBe(
			"if: { id: onboarding-skip, assertion: not-visible, then: [{ if: { id: allow-button, timeoutMs: 500, then: [{ tap: { id: allow-button } }] } }], else: [{ tap: { id: onboarding-skip } }] }",
		);
	});

	test("rejects a Branch with both `text` and `id`, or with neither", () => {
		const errors = errorsOf(`version: 1
actions:
  - if:
      text: Skip
      id: skip
      then:
        - tap: Skip
  - if:
      then:
        - if: { label: Later, id: later, then: [tap: Later] }
`);
		expect(formatCaseScriptFileErrors(errors)).toBe(
			[
				"Line 5, action 1: if: write `text` or `id`, not both",
				"Line 8, action 2: if: needs `text:` or `id:` (what to look for on the Screen)",
				"Line 10, action 2 → then → action 1: if: write `text` or `id`, not both",
			].join("\n"),
		);
	});

	test("the catalog model takes exactly one of `text` or `id`", () => {
		const then = [{ type: "tap", label: "Go" }];
		const parse = (target: object) =>
			caseScriptActionSchema.safeParse({ type: "branch", ...target, then }).success;
		expect(parse({ text: "Go" })).toBe(true);
		expect(parse({ id: "go" })).toBe(true);
		expect(parse({ text: "Go", id: "go" })).toBe(false);
		expect(parse({})).toBe(false);
	});

	test("keeps comments inside branches when the file is kept as written", () => {
		const commented = `version: 1
actions:
  - if:
      text: Rate this app
      then:
        # Not now keeps the prompt away for this Run
        - tap: Not now
`;
		expect(toCaseScriptFileText(commented).text).toBe(commented);
		expect(parseOk(commented).script.actions).toHaveLength(1);
	});

	test("reads a legacy JSON Branch by its type", () => {
		const legacy = {
			version: 1,
			savedAt: 3,
			actions: [
				{ type: "branch", text: "Allow", then: [{ type: "tap", label: "Allow" }], else: [] },
			],
		};
		expect(parseOk(JSON.stringify(legacy)).script.actions).toEqual([
			{
				type: "branch",
				text: "Allow",
				assertion: "visible",
				then: [{ type: "tap", label: "Allow" }],
			},
		]);
	});

	test("names the line and nested position of a bad Branch", () => {
		const errors = errorsOf(`version: 1
actions:
  - wait: 100
  - if:
      text: A
  - if:
      text: B
      then: []
  - if:
      then:
        - tap: Go
  - if:
      text: C
      colour: red
      then:
        - tap: Go
  - if:
      text: D
      then:
        - tap: Go
        - if:
            text: E
            else:
              - tapp: x
  - if: Allow
`);
		expect(formatCaseScriptFileErrors(errors)).toBe(
			[
				"Line 4, action 2: if: needs `then:` with at least one action",
				"Line 8, action 3: if: needs `then:` with at least one action",
				"Line 9, action 4: if: needs `text:` or `id:` (what to look for on the Screen)",
				'Line 14, action 5: if: unknown field "colour" (allowed: text, label, id, assertion, timeoutMs, then, else, reason)',
				"Line 21, action 6 → then → action 2: if: needs `then:` with at least one action",
				'Line 24, action 6 → then → action 2 → else → action 1: unknown action "tapp" (expected one of: tap, swipe, drag, type, wait, assert, alert, activate-app, terminate-app, restart-app, background-app, open-url, key, if)',
				"Line 25, action 7: if has no short form; write it as a map with `text:` and `then:`",
			].join("\n"),
		);
	});
});
