/**
 * The Everyday browser's first-use warning (ADR-0009): the agent acts in the user's own
 * signed-in session, so each App connects to it only once the user has accepted that. The
 * acceptance is remembered per App (`default` with no App) where the desktop and the CLI
 * both read it: in the catalog.
 */

import { DEFAULT_PROFILE_APP } from "./chromium-browsers";
import { everydayBrowserIdOf } from "./chromium-everyday";

export const EVERYDAY_WARNING =
	"Yoqa will drive your Everyday browser, signed in as you. The agent acts in your real accounts there: what it sends, buys or deletes is real. It works in a window of its own, never reads your other tabs, and never clears your cookies, storage or cache.";

/** A connect to the Everyday browser for an App that has not accepted the warning yet. */
export class EverydayWarningRequiredError extends Error {
	readonly warning = EVERYDAY_WARNING;

	constructor(readonly appId: string) {
		super(
			`Connecting to your Everyday browser for ${appId} needs the first-use warning accepted: connect again with acceptEverydayWarning`,
		);
		this.name = "EverydayWarningRequiredError";
	}
}

/** Where each App's acceptance is kept. */
export type EverydayWarningAcceptances = {
	isAccepted: (appId: string) => Promise<boolean>;
	accept: (appId: string) => Promise<void>;
};

/**
 * Let a connect to an Everyday browser through once its App has accepted the warning, on
 * this request or an earlier one; an accepting request is remembered. Any other web device
 * passes as it is.
 */
export async function passEverydayWarning(
	request: { deviceId: string; appId?: string; acceptEverydayWarning?: boolean },
	acceptances: EverydayWarningAcceptances,
): Promise<void> {
	if (everydayBrowserIdOf(request.deviceId) === null) return;
	const appId = request.appId ?? DEFAULT_PROFILE_APP;
	if (request.acceptEverydayWarning) {
		await acceptances.accept(appId);
		return;
	}
	if (!(await acceptances.isAccepted(appId))) throw new EverydayWarningRequiredError(appId);
}
