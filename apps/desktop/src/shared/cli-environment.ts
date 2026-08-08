export type SkillTargetId = "standard" | "claude" | "cursor" | "codex";

export type CliInstallState =
	| { status: "not_installed" }
	| { status: "installed"; path: string; target: string; managed: boolean }
	| { status: "foreign"; path: string; target: string | null };

export type SkillTargetState = {
	id: SkillTargetId;
	label: string;
	path: string;
	displayPath: string;
	status: "missing" | "linked" | "foreign" | "copied";
	pointsTo: string | null;
};

export type CliEnvironmentSnapshot = {
	cli: CliInstallState & {
		preferredLinkPath: string;
		resolvedBinaryTarget: string | null;
		bunAvailable: boolean;
		pathHint: string | null;
	};
	skill: {
		sourceDir: string | null;
		installDir: string;
		displayInstallDir: string;
		installed: boolean;
		targets: SkillTargetState[];
	};
};

export type InstallResult = { ok: true; path: string } | { ok: false; error: string };

export type InstallSkillResult =
	| { ok: true; installDir: string; targets: SkillTargetState[] }
	| { ok: false; error: string };

export type OpenPathResult = { ok: true } | { ok: false; error: string };
