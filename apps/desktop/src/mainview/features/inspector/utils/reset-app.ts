import { type ActionResponse, type CaseScriptAction, formatAppReset } from "@yoqa/runner-client";

/** One Reset (an App) a run is about to do: the App it wipes, and whether the keychain goes too. */
export type PendingReset = { appId: string; keychain: boolean };

/** The Resets among `actions`; the Inspector asks before it runs any of them. */
export function resetStepsIn(actions: CaseScriptAction[]): PendingReset[] {
	return actions.flatMap((action) =>
		action.type === "reset-app"
			? [{ appId: action.appId, keychain: action.keychain === true }]
			: [],
	);
}

/** What the confirm dialog says a Reset will do. */
export function resetAppConfirmation(reset: PendingReset): string {
	const keychain = reset.keychain
		? " On an iOS simulator it also resets the whole keychain, which signs every app on it out."
		: "";
	return `Reset ends ${reset.appId} and clears its data on this device, as a fresh install would leave it. It stays installed and is not launched again.${keychain} This can't be undone.`;
}

/** What a finished step reports beyond ok: a Reset's cleared / kept lists. */
export function stepResultDetail(response: ActionResponse | undefined): string | null {
	return response?.reset ? formatAppReset(response.reset) : null;
}
