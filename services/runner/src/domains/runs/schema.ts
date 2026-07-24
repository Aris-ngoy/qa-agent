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
	detail: text("detail"),
	createdAt: integer("created_at").notNull(),
});
