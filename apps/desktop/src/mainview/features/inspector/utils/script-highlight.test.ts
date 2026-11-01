import { describe, expect, test } from "bun:test";
import { type ScriptTokenKind, scriptDiagnostics, scriptTokens } from "./script-highlight";

/** The kind of every token whose text is `text`, in order. */
function kindsOf(script: string, text: string): ScriptTokenKind[] {
	return scriptTokens(script)
		.filter((token) => script.slice(token.from, token.to) === text)
		.map((token) => token.kind);
}

const script = [
	"version: 1",
	"name: Discover",
	"actions:",
	"  # scroll down",
	"  - swipe: { x: 500, y: 800, x2: 500, y2: 200 }",
	"  - assert: Profile",
	'  - type: "hello # not a comment"',
	"  - swpie: { x: 1 }",
].join("\n");

describe("scriptTokens", () => {
	test("colours a comment line as one comment", () => {
		expect(kindsOf(script, "# scroll down")).toEqual(["comment"]);
	});

	test("colours file keys, Action names, and field keys apart", () => {
		expect(kindsOf(script, "version")).toEqual(["fileKey"]);
		expect(kindsOf(script, "actions")).toEqual(["fileKey"]);
		expect(kindsOf(script, "swipe")).toEqual(["action"]);
		expect(kindsOf(script, "assert")).toEqual(["action"]);
		expect(kindsOf(script, "type")).toEqual(["action"]);
		expect(kindsOf(script, "x2")).toEqual(["key"]);
	});

	test("leaves a misspelled Action name as a plain key", () => {
		expect(kindsOf(script, "swpie")).toEqual(["key"]);
	});

	test("colours numbers, strings, and punctuation", () => {
		expect(kindsOf(script, "500")).toEqual(["number", "number"]);
		expect(kindsOf(script, "Discover")).toEqual(["string"]);
		expect(kindsOf(script, "Profile")).toEqual(["string"]);
		expect(kindsOf(script, '"hello # not a comment"')).toEqual(["string"]);
		expect(kindsOf(script, "{")).toEqual(["punctuation", "punctuation"]);
		expect(kindsOf(script, "-")).toEqual([
			"punctuation",
			"punctuation",
			"punctuation",
			"punctuation",
		]);
	});

	test("colours Branch keywords apart from the Actions nested under them", () => {
		const branched = [
			"version: 1",
			"actions:",
			"  - if:",
			"      text: Allow notifications",
			"      then:",
			"        - tap: Allow",
			"        - if:",
			"            text: Welcome",
			"            then:",
			"              - wait: 500",
			"      else:",
			"        - key: Escape # dismiss",
			"  - if: { label: Skip, then: [tap: Skip], else: [] }",
		].join("\n");
		expect(kindsOf(branched, "if")).toEqual(["branch", "branch", "branch"]);
		expect(kindsOf(branched, "then")).toEqual(["branch", "branch", "branch"]);
		expect(kindsOf(branched, "else")).toEqual(["branch", "branch"]);
		expect(kindsOf(branched, "tap")).toEqual(["action", "action"]);
		expect(kindsOf(branched, "wait")).toEqual(["action"]);
		expect(kindsOf(branched, "key")).toEqual(["action"]);
		expect(kindsOf(branched, "text")).toEqual(["key", "key"]);
		expect(kindsOf(branched, "# dismiss")).toEqual(["comment"]);
	});

	test("only colours an Action name where a step starts", () => {
		const nested = ["actions:", "  - tap: { type: x }", "type: 1"].join("\n");
		expect(kindsOf(nested, "tap")).toEqual(["action"]);
		expect(kindsOf(nested, "type")).toEqual(["key", "fileKey"]);
	});

	test("keeps a URL with colons as one string", () => {
		const url = "actions:\n  - open-url: https://example.com:8080/a";
		expect(kindsOf(url, "open-url")).toEqual(["action"]);
		expect(kindsOf(url, "https://example.com:8080/a")).toEqual(["string"]);
	});

	test("reads a block scalar's lines as its text", () => {
		const block = "actions:\n  - type: |\n      a: b\n  - tap: x";
		expect(kindsOf(block, "a: b")).toEqual(["string"]);
		expect(kindsOf(block, "tap")).toEqual(["action"]);
	});

	test("does not throw on half-typed YAML", () => {
		for (const text of ["", "actions:\n  - tap: {", "  - 'unterminated", "- [", "::", "\n\n#"]) {
			expect(() => scriptTokens(text)).not.toThrow();
		}
	});

	test("returns tokens in order without overlaps", () => {
		const tokens = scriptTokens(script);
		for (let i = 1; i < tokens.length; i++) {
			expect(tokens[i]?.from).toBeGreaterThanOrEqual(tokens[i - 1]?.to ?? 0);
		}
	});
});

describe("scriptDiagnostics", () => {
	test("marks the text of each line an error names and skips errors without a line", () => {
		const text = "version: 1\nactions:\n  - swpie: 1";
		const diagnostics = scriptDiagnostics(text, [
			{ lineNumber: 3, message: "Unknown action" },
			{ lineNumber: null, message: "Whole file" },
			{ lineNumber: 99, message: "Past the end" },
		]);
		expect(diagnostics).toEqual([{ from: 22, to: 32, message: "Unknown action" }]);
		expect(text.slice(22, 32)).toBe("- swpie: 1");
	});
});
