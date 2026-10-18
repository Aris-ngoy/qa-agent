import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCaseScript } from "./case-script-replay";
import type { ActionRequest, CaseScript, CaseScriptAction, ScreenElement } from "./schemas";
import { formatCaseScriptShell, suggestedScriptBasename } from "./script-format";

const script: CaseScript = {
	version: 1,
	savedAt: 1_700_000_000_000,
	actions: [
		{ type: "tap", x: 100, y: 200 },
		{ type: "type", text: "it's ok" },
		{ type: "wait", ms: 1500 },
	],
};

describe("formatCaseScriptShell", () => {
	test("emits bash replay lines with escaped quotes", () => {
		const out = formatCaseScriptShell(script, {
			caseNumber: 3,
			caseName: "Login",
		});
		expect(out).toContain("# Yoqa exported script — #3 Login");
		expect(out).toContain("yoqa action tap --x 100 --y 200");
		expect(out).toContain("yoqa action input --text 'it'\\''s ok'");
		expect(out).toContain("sleep 1.5");
	});

	test("emits label taps and asserts", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "assert", assertion: "visible", text: "Yoqa Demo", timeoutMs: 60_000 },
				{ type: "tap", label: "Increment" },
			],
		});
		expect(out).toContain("yoqa assert visible --text 'Yoqa Demo' --timeout 60");
		expect(out).toContain("yoqa action tap --label 'Increment'");
	});

	test("emits a Branch as a bash `if` on `yoqa assert`, nested and indented", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [
				{
					type: "branch",
					text: "Don't allow",
					assertion: "visible",
					then: [
						{ type: "tap", label: "Allow" },
						{
							type: "branch",
							text: "Loading",
							assertion: "not-visible",
							timeoutMs: 5000,
							then: [{ type: "wait", ms: 500 }],
							else: [{ type: "tap", label: "Retry" }],
						},
					],
				},
				{ type: "tap", label: "Home" },
			],
		});
		expect(out).toContain(
			[
				"if yoqa_branch yoqa assert visible --text 'Don'\\''t allow' --timeout 2; then",
				"  yoqa action tap --label 'Allow'",
				"  if yoqa_branch yoqa assert not-visible --text 'Loading' --timeout 5; then",
				"    sleep 0.5",
				"  else",
				"    yoqa action tap --label 'Retry'",
				"  fi",
				"fi",
				"yoqa action tap --label 'Home'",
			].join("\n"),
		);
	});

	test("defines the yoqa_branch helper once, and only for a script with a Branch", () => {
		const branch: CaseScriptAction = {
			type: "branch",
			text: "Rate us",
			assertion: "visible",
			then: [{ type: "tap", label: "Later" }],
		};
		const branched = formatCaseScriptShell({ version: 1, savedAt: 1, actions: [branch, branch] });
		expect(branched.split("\n").filter((line) => line === "yoqa_branch() {")).toHaveLength(1);
		const flat = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [{ type: "tap", label: "Home" }],
		});
		expect(flat).not.toContain("yoqa_branch");
	});

	test("exports a Branch on an id as a bash `if` on `yoqa assert --id`", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [
				{
					type: "branch",
					id: "onboarding's-skip",
					assertion: "not-visible",
					timeoutMs: 1000,
					then: [{ type: "tap", label: "Next" }],
					else: [{ type: "tap", id: "onboarding's-skip" }],
				},
			],
		});
		expect(out).toContain(
			[
				"if yoqa_branch yoqa assert not-visible --id 'onboarding'\\''s-skip' --timeout 1; then",
				"  yoqa action tap --label 'Next'",
				"else",
				"  yoqa action tap --id 'onboarding'\\''s-skip'",
				"fi",
			].join("\n"),
		);
	});

	test("exports a Branch's timeout exactly, since rounding it could change the side taken", () => {
		const branch = (timeoutMs: number) =>
			formatCaseScriptShell({
				version: 1,
				savedAt: 1,
				actions: [
					{
						type: "branch",
						text: "Rate us",
						assertion: "visible",
						timeoutMs,
						then: [{ type: "tap", label: "Later" }],
					},
				],
			});
		expect(branch(0)).toContain(
			"if yoqa_branch yoqa assert visible --text 'Rate us' --timeout 0; then",
		);
		expect(branch(1500)).toContain(
			"if yoqa_branch yoqa assert visible --text 'Rate us' --timeout 1.5; then",
		);
	});

	test("emits swipe coordinates", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [{ type: "swipe", x: 500, y: 800, x2: 500, y2: 200, durationMs: 400 }],
		});
		expect(out).toContain("yoqa action swipe --x 500 --y 800 --x2 500 --y2 200 --duration 400");
	});

	test("emits drag, app lifecycle, open-url, and double-tap", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [
				{ type: "tap", x: 10, y: 20, double: true },
				{ type: "drag", x: 100, y: 500, x2: 800, y2: 500, durationMs: 300 },
				{ type: "restart-app", appId: "com.example.app" },
				{ type: "background-app", seconds: 2 },
				{ type: "open-url", url: "https://example.com" },
				{ type: "key", key: "Escape", modifiers: ["Meta"] },
			],
		});
		expect(out).toContain("yoqa action tap --x 10 --y 20 --double");
		expect(out).toContain("yoqa action drag --x 100 --y 500 --x2 800 --y2 500 --duration 300");
		expect(out).toContain("yoqa action restart-app --app-id 'com.example.app'");
		expect(out).toContain("yoqa action background-app --seconds 2");
		expect(out).toContain("yoqa action open-url --url 'https://example.com'");
		expect(out).toContain("yoqa action key Escape --modifiers Meta");
	});

	test("emits accept alert", () => {
		const out = formatCaseScriptShell({
			version: 1,
			savedAt: 1,
			actions: [{ type: "alert", alertAction: "accept" }],
		});
		expect(out).toContain("yoqa action alert");
		expect(out).not.toContain("--dismiss");
	});
});

/**
 * A `yoqa` on PATH for the exported bash: `assert` answers from the Screen file (one label
 * or `#id` per line, matched exactly) and exits 1 on a miss, or `YOQA_ASSERT_EXIT` when set
 * (a runner it could not reach); an action is logged.
 */
const FAKE_YOQA = `#!/usr/bin/env bash
if [ "$1" = assert ]; then
  [ -n "\${YOQA_ASSERT_EXIT:-}" ] && exit "$YOQA_ASSERT_EXIT"
  key="$4"
  [ "$3" = --id ] && key="#$4"
  if grep -qxF -- "$key" "$YOQA_SCREEN"; then found=yes; else found=no; fi
  [ "$2" = visible ] && [ "$found" = yes ] && exit 0
  [ "$2" = not-visible ] && [ "$found" = no ] && exit 0
  exit 1
fi
echo "$*" >> "$YOQA_LOG"
`;

describe("formatCaseScriptShell run with bash", () => {
	let workDir = "";

	afterAll(async () => {
		if (workDir) await rm(workDir, { recursive: true, force: true });
	});

	const branched: CaseScript = {
		version: 1,
		savedAt: 1,
		actions: [
			{
				type: "branch",
				text: "Don't allow",
				assertion: "visible",
				then: [
					{ type: "tap", label: "Allow" },
					{
						type: "branch",
						id: "onboarding's-skip",
						assertion: "not-visible",
						timeoutMs: 1000,
						then: [{ type: "tap", label: "Next" }],
						else: [{ type: "tap", id: "onboarding's-skip" }],
					},
				],
			},
			{
				type: "branch",
				text: "Signed in",
				assertion: "visible",
				then: [{ type: "tap", label: "Profile" }],
				else: [{ type: "tap", label: "Sign in" }],
			},
			{ type: "tap", label: "Home" },
		],
	};

	/** The taps the Case Script replay sends on a Screen that never changes. */
	async function replayedTaps(screen: string[]): Promise<string[]> {
		const requests: ActionRequest[] = [];
		let clock = 0;
		const elements = screen.map(
			(entry) =>
				({
					type: "Button",
					x: 0,
					y: 0,
					width: 10,
					height: 10,
					...(entry.startsWith("#") ? { label: "", id: entry.slice(1) } : { label: entry }),
				}) as ScreenElement,
		);
		const result = await runCaseScript(
			{
				performAction: async (request) => {
					requests.push(request);
					return { ok: true } as never;
				},
				getScreen: async () => ({ elements }) as never,
			},
			branched,
			{
				sleep: async (ms) => {
					clock += ms;
				},
				now: () => clock,
			},
		);
		expect(result.ok).toBe(true);
		return requests.map(
			(r) => `action tap ${r.label != null ? `--label ${r.label}` : `--id ${r.id}`}`,
		);
	}

	/** The `yoqa action` lines the exported bash runs on that Screen. */
	async function shellTaps(screen: string[]): Promise<string[]> {
		const run = await runExported(screen);
		expect(run.stderr).toBe("");
		expect(run.exitCode).toBe(0);
		return run.actions;
	}

	/** Run the exported bash on that Screen, with extra environment for the stand-in `yoqa`. */
	async function runExported(
		screen: string[],
		env: Record<string, string> = {},
	): Promise<{ exitCode: number; stderr: string; actions: string[] }> {
		workDir ||= await mkdtemp(join(tmpdir(), "yoqa-shell-export-"));
		const bin = join(workDir, "bin");
		const yoqa = join(bin, "yoqa");
		await Bun.write(yoqa, FAKE_YOQA);
		await chmod(yoqa, 0o755);
		const scriptPath = join(workDir, "script.sh");
		const screenPath = join(workDir, "screen.txt");
		const logPath = join(workDir, "log.txt");
		await Bun.write(scriptPath, formatCaseScriptShell(branched));
		await Bun.write(screenPath, screen.map((line) => `${line}\n`).join(""));
		await Bun.write(logPath, "");
		const run = Bun.spawnSync(["bash", scriptPath], {
			env: {
				...process.env,
				PATH: `${bin}:${process.env.PATH}`,
				YOQA_SCREEN: screenPath,
				YOQA_LOG: logPath,
				...env,
			},
		});
		return {
			exitCode: run.exitCode,
			stderr: run.stderr.toString(),
			actions: (await Bun.file(logPath).text()).split("\n").filter(Boolean),
		};
	}

	test.each([
		["nothing on the Screen", []],
		["the outer target only", ["Don't allow"]],
		["the outer target and the nested id", ["Don't allow", "#onboarding's-skip"]],
		["only the else-side target", ["Signed in"]],
	])("takes the Case Script's path with %s", async (_name, screen) => {
		const expected = await replayedTaps(screen);
		expect(await shellTaps(screen)).toEqual(expected);
	});

	test("stops at a Branch that could not check the Screen, taking neither side", async () => {
		const run = await runExported(["Signed in"], { YOQA_ASSERT_EXIT: "2" });
		expect(run.exitCode).toBe(2);
		expect(run.actions).toEqual([]);
	});

	test("the paths differ between Screens, so the comparison can fail", async () => {
		expect(await shellTaps([])).toEqual(["action tap --label Sign in", "action tap --label Home"]);
		expect(await shellTaps(["Don't allow", "#onboarding's-skip", "Signed in"])).toEqual([
			"action tap --label Allow",
			"action tap --id onboarding's-skip",
			"action tap --label Profile",
			"action tap --label Home",
		]);
	});
});

describe("suggestedScriptBasename", () => {
	test("slugs metadata and falls back", () => {
		expect(
			suggestedScriptBasename({
				appPrefix: "Demo App",
				caseNumber: 12,
				caseName: "Sign In!",
			}),
		).toBe("demo-app-12-sign-in");
		expect(suggestedScriptBasename({})).toBe("yoqa-script");
	});
});
