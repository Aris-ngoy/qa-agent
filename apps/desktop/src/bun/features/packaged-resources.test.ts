import { describe, expect, test } from "bun:test";
import {
	executableFileName,
	packagedRunnerFileCandidates,
	packagedSkillFileCandidates,
} from "./packaged-resources";

describe("executableFileName", () => {
	test("adds .exe only on Windows", () => {
		expect(executableFileName("yoqa-runner", "win32")).toBe("yoqa-runner.exe");
		expect(executableFileName("yoqa", "darwin")).toBe("yoqa");
		expect(executableFileName("yoqa", "linux")).toBe("yoqa");
	});
});

describe("packagedRunnerFileCandidates", () => {
	test("includes MacOS and Resources layouts for CLI and runner binaries", () => {
		const roots = ["/Apps/Yoqa.app/Contents/MacOS"];
		const runner = packagedRunnerFileCandidates("yoqa-runner", roots);
		const cli = packagedRunnerFileCandidates("yoqa", roots);

		expect(runner).toContain("/Apps/Yoqa.app/Contents/MacOS/yoqa-runner");
		expect(runner).toContain(
			"/Apps/Yoqa.app/Contents/Resources/app.asar.unpacked/runner/yoqa-runner",
		);
		expect(cli).toContain("/Apps/Yoqa.app/Contents/MacOS/yoqa");
		expect(cli).toContain("/Apps/Yoqa.app/Contents/Resources/app.asar.unpacked/runner/yoqa");
	});
});

describe("packagedSkillFileCandidates", () => {
	test("includes Resources layouts for the skill archive", () => {
		const paths = packagedSkillFileCandidates("yoqa-testing.tar.gz", [
			"/Apps/Yoqa.app/Contents/MacOS",
		]);
		expect(paths).toContain(
			"/Apps/Yoqa.app/Contents/Resources/app.asar.unpacked/skills/yoqa-testing.tar.gz",
		);
		expect(paths).toContain("/Apps/Yoqa.app/Contents/Resources/skills/yoqa-testing.tar.gz");
	});
});
