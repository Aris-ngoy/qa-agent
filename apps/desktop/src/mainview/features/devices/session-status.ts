import type { ActiveDeviceResponse, LaneName, RunTestStatus } from "@yoqa/runner-client";
import type { SelectedDevice } from "./select-device-modal";

const LANE_LABELS: Record<LaneName, string> = { direct: "Direct", appium: "Appium" };

/** The session pill: "Live · Direct", or "Connected · Appium" when there is no live stream. */
export function sessionPillLabel(session: Pick<ActiveDeviceResponse, "streamReady" | "lane">) {
	const state = session.streamReady === false ? "Connected" : "Live";
	return session.lane ? `${state} · ${LANE_LABELS[session.lane]}` : state;
}

/** Only an iOS session on the Appium lane runs WebDriverAgent, so only it can rebuild it. */
export function offersWdaRebuild(
	session: Pick<ActiveDeviceResponse, "platform" | "lane"> | null,
): boolean {
	return session?.platform === "ios" && session.lane === "appium";
}

export type RunChip = {
	/** The Run holding the session, to link to and cancel; null when the runner did not say. */
	runId: string | null;
	label: string;
};

/**
 * The chip for the Run that holds the Active Session: how many of its cases have started,
 * out of all of them. Null while no Run holds the session.
 */
export function runChip(
	session: Pick<ActiveDeviceResponse, "heldByRun" | "heldByRunId"> | null,
	run: { tests: ReadonlyArray<{ status: RunTestStatus }> } | null,
): RunChip | null {
	if (!session?.heldByRun) return null;
	const runId = session.heldByRunId ?? null;
	if (!runId) return { runId: null, label: "Run in progress" };
	if (!run) return { runId, label: "Running" };
	const started = run.tests.filter((test) => test.status !== "queued").length;
	return { runId, label: `Running · ${started}/${run.tests.length}` };
}

/**
 * What Run starts on: the Active Session, or the picked device once it is connected.
 * Null when there is neither, the only case Run is disabled for want of a device.
 */
export function runTarget(
	session: ActiveDeviceResponse | null,
	device: SelectedDevice | null,
): "session" | "connect-first" | null {
	if (session) return "session";
	return device ? "connect-first" : null;
}
