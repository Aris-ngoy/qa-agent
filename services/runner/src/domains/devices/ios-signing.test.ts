import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	InvalidTeamIdError,
	checkIosSigning,
	getIosSigning,
	setIosSigningTeam,
} from "./ios-signing";
import { type YoqaRunnerDeps, YoqaRunnerError, parseXcodeTeams, saveTeam } from "./yoqa-runner";

// The keychain fixtures hold one usable Apple Development identity on 2026-10-10: team NEWTEAM222.
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const NOW = new Date("2026-10-10T10:00:00Z");
const UDID = "00008120-000E6D813E2A601E";

/** `IDEProvisioningTeamByIdentifier` from Xcode's defaults, as JSON: a personal team. */
const XCODE_TEAMS = JSON.stringify({
	"1322EA01-3CD9-4806-A9E4-FCE2FEBFCC8B": [
		{
			teamID: "T4L8PFGHBJ",
			teamName: "Test Person (Personal Team)",
			isFreeProvisioningTeam: true,
			teamType: "Personal Team",
		},
	],
});

const cleanup: string[] = [];
afterEach(async () => {
	for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(options: { env?: Record<string, string>; xcodeTeams?: string | null } = {}) {
	const root = await mkdtemp(join(tmpdir(), "ios-signing-test-"));
	cleanup.push(root);
	const xcodeTeams = options.xcodeTeams === undefined ? XCODE_TEAMS : options.xcodeTeams;
	const deps: YoqaRunnerDeps = {
		exec: async ([tool, ...args]) => {
			const ok = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });
			if (tool === "security" && args[0] === "find-identity") {
				return ok(fixture("security-find-identity.txt"));
			}
			if (tool === "security" && args[0] === "find-certificate") {
				return ok(fixture("security-find-certificate.txt"));
			}
			if (tool === "sh" && xcodeTeams !== null) return ok(xcodeTeams);
			return { stdout: "", stderr: "Could not extract value", exitCode: 1 };
		},
		env: options.env ?? {},
		projectDir: join(root, "project"),
		cacheRoot: join(root, "cache"),
		settingsPath: join(root, "ios-signing.json"),
		now: () => NOW,
	};
	return deps;
}

describe("parseXcodeTeams", () => {
	test("reads each team once, with its name and whether it is free", () => {
		const twice = JSON.parse(XCODE_TEAMS);
		twice.other = twice["1322EA01-3CD9-4806-A9E4-FCE2FEBFCC8B"];
		expect(parseXcodeTeams(JSON.stringify(twice))).toEqual([
			{ id: "T4L8PFGHBJ", name: "Test Person (Personal Team)", personal: true },
		]);
	});

	test("anything else is no teams", () => {
		expect(parseXcodeTeams("")).toEqual([]);
		expect(parseXcodeTeams("[]")).toEqual([]);
		expect(parseXcodeTeams('{"a":[{"teamID":"short"}]}')).toEqual([]);
	});
});

describe("getIosSigning", () => {
	test("lists Xcode's teams and the keychain's, and signs with the newest certificate", async () => {
		const status = await getIosSigning(await setup());
		expect(status).toEqual({
			team: "NEWTEAM222",
			source: "keychain",
			saved: null,
			envOverride: null,
			bundleId: "dev.yoqa.runner.newteam222",
			teams: [
				{
					id: "NEWTEAM222",
					name: "Apple Development: Test Person (NEWID22222)",
					personal: null,
					inXcode: false,
					certificate: {
						name: "Apple Development: Test Person (NEWID22222)",
						expiresAt: "2027-04-01T00:00:00.000Z",
					},
				},
				{
					id: "T4L8PFGHBJ",
					name: "Test Person (Personal Team)",
					personal: true,
					inXcode: true,
					certificate: null,
				},
			],
		});
	});

	test("without Xcode's account list it still lists the keychain's teams", async () => {
		const status = await getIosSigning(await setup({ xcodeTeams: null }));
		expect(status.teams.map((team) => team.id)).toEqual(["NEWTEAM222"]);
	});

	test("YOQA_IOS_TEAM_ID wins and is reported as the override", async () => {
		const deps = await setup({ env: { YOQA_IOS_TEAM_ID: "envteam999" } });
		await saveTeam(deps.settingsPath, "T4L8PFGHBJ");
		const status = await getIosSigning(deps);
		expect(status).toMatchObject({
			team: "ENVTEAM999",
			source: "env",
			saved: "T4L8PFGHBJ",
			envOverride: "ENVTEAM999",
		});
		expect(status.teams.map((team) => team.id)).toContain("ENVTEAM999");
	});
});

describe("setIosSigningTeam", () => {
	test("saves a team, upper-cased, and signs with it", async () => {
		const deps = await setup();
		const status = await setIosSigningTeam(" t4l8pfghbj ", deps);
		expect(status).toMatchObject({ team: "T4L8PFGHBJ", source: "saved", saved: "T4L8PFGHBJ" });
		expect(JSON.parse(await readFile(deps.settingsPath, "utf8"))).toEqual({ team: "T4L8PFGHBJ" });
	});

	test("null goes back to the keychain's newest identity", async () => {
		const deps = await setup();
		await setIosSigningTeam("T4L8PFGHBJ", deps);
		expect(await setIosSigningTeam(null, deps)).toMatchObject({
			team: "NEWTEAM222",
			source: "keychain",
			saved: null,
		});
	});

	test("rejects something that is not a team ID and keeps the saved one", async () => {
		const deps = await setup();
		await setIosSigningTeam("T4L8PFGHBJ", deps);
		await expect(setIosSigningTeam("Apple Development", deps)).rejects.toBeInstanceOf(
			InvalidTeamIdError,
		);
		expect((await getIosSigning(deps)).saved).toBe("T4L8PFGHBJ");
	});
});

describe("checkIosSigning", () => {
	test("a signed build says the team can sign for the phone, and until when", async () => {
		const deps = await setup();
		const check = await checkIosSigning(UDID, deps, async () => ({
			team: "T4L8PFGHBJ",
			xctestrun: "/x.xctestrun",
			action: "built",
			profileExpiresAt: "2026-10-17T10:00:00.000Z",
			devices: [UDID],
		}));
		expect(check).toEqual({
			ok: true,
			deviceId: UDID,
			team: "T4L8PFGHBJ",
			action: "built",
			profileExpiresAt: "2026-10-17T10:00:00.000Z",
			devices: [UDID],
			message: "Team T4L8PFGHBJ can sign for this iPhone (profile refreshed, expires 2026-10-17).",
		});
	});

	test("a signing failure is an answer with the fix, not an error", async () => {
		const deps = await setup();
		await saveTeam(deps.settingsPath, "T4L8PFGHBJ");
		const check = await checkIosSigning(UDID, deps, async () => {
			throw new YoqaRunnerError("YoqaRunner could not be built for team T4L8PFGHBJ: no account.");
		});
		expect(check).toMatchObject({ ok: false, team: "T4L8PFGHBJ", action: null });
		expect(check.message).toContain("no account");
	});

	test("anything else still throws", async () => {
		const deps = await setup();
		const failure = checkIosSigning(UDID, deps, async () => {
			throw new Error("disk full");
		});
		await expect(failure).rejects.toThrow("disk full");
	});
});
