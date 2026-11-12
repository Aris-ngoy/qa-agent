import {
	type BrowserProfile,
	type CaseScript,
	type CatalogApp,
	type CatalogCase,
	type Run,
	type RunTest,
	appStartTarget,
	browserProfileSchema,
} from "@yoqa/runner-client";
import { installBuildOnDevice, resolveBuildForRun } from "../builds/application";
import { getApp, getCase } from "../catalog/application";
import type { DeviceSession } from "../devices/session";
import { type ActiveProviderAuth, resolveActiveProviderAuth } from "../providers/application";
import { assertVisionCapableProvider } from "./agent";
import { type CaseMode, caseModeFor } from "./case-executor";
import { RunValidationError } from "./errors";

/** One Test Case of a Run, loaded once from the catalog (its Case Script parsed), and how it runs. */
export type PlannedCase = {
	test: RunTest;
	/** Null when the case was deleted before the Run started. */
	catalogCase: CatalogCase | null;
	mode: CaseMode;
};

/** What a Run needs before it acquires its Device Session. */
export type RunPlan = {
	app: CatalogApp;
	/** What the App opens on this platform: its Web URL, bundle id or package. */
	startTarget: string | undefined;
	cases: PlannedCase[];
	/** The Provider agent cases decide with; null when every case replays a Case Script. */
	auth: ActiveProviderAuth | null;
};

/**
 * Get a Run ready to acquire its Device Session: its App and what it opens, each Test Case
 * loaded once with its mode, the Provider when any case needs the agent, and the Run's
 * build installed. Throws when the Run cannot start.
 */
export async function prepareRun(run: Run): Promise<RunPlan> {
	const app = await getApp(run.appId);
	if (!app) {
		throw new RunValidationError("App not found");
	}
	const startTarget = appStartTarget(app, run.platform);
	if (run.platform === "web" && !startTarget) {
		throw new RunValidationError(
			`${app.name} has no Web URL, so a Run on web has nothing to open. Set one with: yoqa apps update ${app.prefix} --web-url <url>`,
		);
	}

	const cases: PlannedCase[] = [];
	for (const test of run.tests) {
		const catalogCase = await getCase(test.caseId);
		cases.push({
			test,
			catalogCase,
			mode: caseModeFor(run.executionMode, Boolean(catalogCase?.hasScript)),
		});
	}

	const auth = cases.some((item) => item.mode === "agent")
		? await assertVisionCapableProvider(await resolveActiveProviderAuth())
		: null;

	if (run.buildId) {
		const build = await resolveBuildForRun({ buildId: run.buildId, appId: run.appId });
		if (build) {
			await installBuildOnDevice({ build, deviceId: run.deviceId, platform: run.platform });
		}
	}

	return { app, startTarget, cases, auth };
}

/**
 * The browser profile a web Run opens: the one the Run asked for, else `clean` when any of
 * its Case Scripts asks for it (one session runs every case), else its App's Kept profile.
 */
export function runProfileOf(
	requested: string | null | undefined,
	scripts: Array<CaseScript | null | undefined>,
): BrowserProfile {
	const asked = browserProfileSchema.safeParse(requested);
	if (asked.success) return asked.data;
	return scripts.some((script) => script?.profile === "clean") ? "clean" : "kept";
}

/**
 * Open the App before the first case. On web that is loading its Web URL in the page. A
 * phone's session only targets the app's id (acquireSessionForRun), and opens nothing here.
 */
export async function openStartTarget(
	session: DeviceSession,
	platform: Run["platform"],
	startTarget: string | undefined,
): Promise<void> {
	switch (platform) {
		case "ios":
		case "android":
			return;
		case "web":
			if (startTarget) await session.openUrl(startTarget);
			return;
	}
}
