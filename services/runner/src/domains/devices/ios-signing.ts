/**
 * The signing team for physical iPhones, one setting the desktop and the CLI share through the
 * runner. `YoqaRunner` builds resolve it with `resolveSigningTeam`; this module lists the teams
 * a Mac can sign with, saves the choice, and checks it with a real signed build.
 */

import type {
	IosSigningCheckResponse,
	IosSigningStatus,
	IosSigningTeam,
} from "@yoqa/runner-client";
import {
	type YoqaRunnerDeps,
	YoqaRunnerError,
	bundleIdFor,
	keychainIdentities,
	normalizeTeamId,
	prepareYoqaRunner,
	readSavedTeam,
	resolveSigningTeam,
	saveTeam,
	yoqaRunnerDeps,
} from "./yoqa-runner";

/** A team ID that is not ten letters and digits. */
export class InvalidTeamIdError extends Error {
	constructor(value: string) {
		super(`"${value}" is not an Apple team ID (ten letters and digits, e.g. T4L8PFGHBJ)`);
		this.name = "InvalidTeamIdError";
	}
}

type XcodeTeam = { id: string; name: string | null; personal: boolean | null };

/**
 * Teams from Xcode › Settings › Accounts: `IDEProvisioningTeamByIdentifier` in Xcode's defaults,
 * `{ accountId: [{ teamID, teamName, isFreeProvisioningTeam }] }`. Empty when Xcode has none.
 */
export function parseXcodeTeams(json: string): XcodeTeam[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return [];
	}
	if (!parsed || typeof parsed !== "object") return [];
	const teams = new Map<string, XcodeTeam>();
	for (const account of Object.values(parsed)) {
		if (!Array.isArray(account)) continue;
		for (const entry of account) {
			const id = normalizeTeamId(entry?.teamID);
			if (!id || teams.has(id)) continue;
			teams.set(id, {
				id,
				name: typeof entry.teamName === "string" ? entry.teamName : null,
				personal:
					typeof entry.isFreeProvisioningTeam === "boolean" ? entry.isFreeProvisioningTeam : null,
			});
		}
	}
	return [...teams.values()];
}

async function xcodeTeams(deps: YoqaRunnerDeps): Promise<XcodeTeam[]> {
	const result = await deps.exec([
		"sh",
		"-c",
		"defaults export com.apple.dt.Xcode - | plutil -extract IDEProvisioningTeamByIdentifier json -o - -",
	]);
	return result.exitCode === 0 ? parseXcodeTeams(result.stdout) : [];
}

/** Which team signs, where it came from, and every team this Mac can sign with. */
export async function getIosSigning(
	deps: YoqaRunnerDeps = yoqaRunnerDeps(),
): Promise<IosSigningStatus> {
	const [resolved, saved, identities, accounts] = await Promise.all([
		resolveSigningTeam(deps),
		readSavedTeam(deps.settingsPath),
		keychainIdentities(deps),
		xcodeTeams(deps),
	]);

	const teams = new Map<string, IosSigningTeam>();
	for (const account of accounts) {
		teams.set(account.id, { ...account, inXcode: true, certificate: null });
	}
	// Newest first, so the first certificate seen for a team is the one it signs with.
	for (const identity of identities) {
		const team = teams.get(identity.team);
		if (team?.certificate) continue;
		const certificate = {
			name: identity.name,
			expiresAt: new Date(identity.expiresAt).toISOString(),
		};
		teams.set(
			identity.team,
			team
				? { ...team, certificate }
				: { id: identity.team, name: identity.name, personal: null, inXcode: false, certificate },
		);
	}
	// A saved or env team this Mac does not know yet still shows, so it can be seen and changed.
	for (const id of [resolved?.team, saved]) {
		if (id && !teams.has(id)) {
			teams.set(id, { id, name: null, personal: null, inXcode: false, certificate: null });
		}
	}

	return {
		team: resolved?.team ?? null,
		source: resolved?.source ?? null,
		saved,
		envOverride: resolved?.source === "env" ? resolved.team : null,
		bundleId: resolved ? bundleIdFor(resolved.team) : null,
		teams: [...teams.values()].sort((a, b) => a.id.localeCompare(b.id)),
	};
}

/** Saves the team (null: the keychain's newest identity) and returns the new status. */
export async function setIosSigningTeam(
	team: string | null,
	deps: YoqaRunnerDeps = yoqaRunnerDeps(),
): Promise<IosSigningStatus> {
	if (team === null || team.trim() === "") {
		await saveTeam(deps.settingsPath, null);
	} else {
		const id = normalizeTeamId(team);
		if (!id) throw new InvalidTeamIdError(team);
		await saveTeam(deps.settingsPath, id);
	}
	return getIosSigning(deps);
}

/**
 * Builds and signs YoqaRunner for one cabled iPhone, as a session would, without launching it.
 * Xcode registers the phone with the team and refreshes the profile on the way. A signing
 * failure is an answer (`ok: false`), not an error.
 */
export async function checkIosSigning(
	deviceId: string,
	deps: YoqaRunnerDeps = yoqaRunnerDeps(),
	prepare: typeof prepareYoqaRunner = prepareYoqaRunner,
): Promise<IosSigningCheckResponse> {
	try {
		const build = await prepare(deviceId, deps);
		const expires = new Date(build.profileExpiresAt).toISOString().slice(0, 10);
		return {
			ok: true,
			deviceId,
			team: build.team,
			action: build.action,
			profileExpiresAt: build.profileExpiresAt,
			devices: build.devices,
			message: `Team ${build.team} can sign for this iPhone (profile ${build.action === "reused" ? "still valid" : "refreshed"}, expires ${expires}).`,
		};
	} catch (error) {
		if (!(error instanceof YoqaRunnerError)) throw error;
		return {
			ok: false,
			deviceId,
			team: (await resolveSigningTeam(deps).catch(() => null))?.team ?? null,
			action: null,
			profileExpiresAt: null,
			devices: null,
			message: error.message,
		};
	}
}
