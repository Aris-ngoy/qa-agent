import type { ActiveDeviceResponse, Device, LaneName, RunTestStatus } from "@yoqa/runner-client";
import type { SelectedDevice } from "./select-device-modal";
import { deviceForSession } from "./session-device";

const LANE_LABELS: Record<LaneName, string> = { direct: "Direct", appium: "Appium" };

/** The session pill: "Live · Direct", or "Connected · Appium" when there is no live stream. */
export function sessionPillLabel(session: Pick<ActiveDeviceResponse, "streamReady" | "lane">) {
	const state = session.streamReady === false ? "Connected" : "Live";
	return session.lane ? `${state} · ${LANE_LABELS[session.lane]}` : state;
}

/**
 * The device "Restart & rebuild WebDriverAgent" rebuilds for, or null when it is not offered.
 * Only an iOS session on the Appium lane runs WebDriverAgent, and the rebuild needs the
 * device's real kind (simulator or physical), so the device list must have the device.
 */
export function wdaRebuildTarget(
	session: Pick<ActiveDeviceResponse, "deviceId" | "platform" | "lane"> | null,
	devices: readonly Device[] | undefined,
): SelectedDevice | null {
	if (session?.platform !== "ios" || session.lane !== "appium") return null;
	return deviceForSession(session, devices);
}

export type RunChip = {
	/** The Run holding the session, to link to and cancel; null when the runner did not say. */
	runId: string | null;
	label: string;
};

/** A case that is done, whatever its outcome; the runs list counts these. */
const FINISHED_CASE_STATUSES = new Set<RunTestStatus>(["passed", "errored", "cancelled"]);

/**
 * The chip for the Run that holds the Active Session: how many of its cases have finished,
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
	const finished = run.tests.filter((test) => FINISHED_CASE_STATUSES.has(test.status)).length;
	return { runId, label: `Running · ${finished}/${run.tests.length}` };
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
