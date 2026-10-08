import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { apps, cases } from "../catalog/schema";

export const runs = sqliteTable("runs", {
	id: text("id").primaryKey(),
	appId: text("app_id")
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	deviceId: text("device_id").notNull(),
	platform: text("platform").notNull(),
	buildId: text("build_id"),
	status: text("status").notNull(),
	/** auto | script | agent — how cases should be executed */
	executionMode: text("execution_mode").notNull().default("auto"),
	/** vision | tree — what the agent sees. Rows from before Screen modes read as tree. */
	screenMode: text("screen_mode").notNull().default("tree"),
	/** appium | direct | auto — requested at create. */
	requestedLane: text("requested_lane"),
	/** appium | direct — Lane that ran. Null on rows from before Lanes. */
	lane: text("lane"),
	laneWarning: text("lane_warning"),
	/** 1 when the Run was started asking to record every case, whatever the cases say. */
	recordVideo: integer("record_video").notNull().default(0),
	error: text("error"),
	createdAt: integer("created_at").notNull(),
	startedAt: integer("started_at"),
	finishedAt: integer("finished_at"),
});

export const runTests = sqliteTable("run_tests", {
	id: text("id").primaryKey(),
	runId: text("run_id")
		.notNull()
		.references(() => runs.id, { onDelete: "cascade" }),
	caseId: text("case_id")
		.notNull()
		.references(() => cases.id, { onDelete: "cascade" }),
	status: text("status").notNull(),
	/** script | agent — resolved mode used for this case */
	executionMode: text("execution_mode"),
	error: text("error"),
	startedAt: integer("started_at"),
	finishedAt: integer("finished_at"),
	/** Shell command currently in flight (cleared when the step finishes). */
	currentCommand: text("current_command"),
	/** recording | ready | unavailable — null when this case was not recorded. */
	recordingStatus: text("recording_status"),
	/** Why the recording is unavailable. */
	recordingNote: text("recording_note"),
});

export const runSteps = sqliteTable("run_steps", {
	id: text("id").primaryKey(),
	runTestId: text("run_test_id")
		.notNull()
		.references(() => runTests.id, { onDelete: "cascade" }),
	idx: integer("idx").notNull(),
	actionJson: text("action_json").notNull().default("{}"),
	screenshotUri: text("screenshot_uri"),
	ok: integer("ok").notNull().default(0),
	latencyMs: integer("latency_ms").notNull().default(0),
	/** JSON StepPhases — per-phase wall-clock breakdown (agent steps only). */
	phasesJson: text("phases_json"),
	detail: text("detail"),
	/** Exact yoqa / sleep command executed for this step. */
	command: text("command"),
	createdAt: integer("created_at").notNull(),
});
