import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Appium capability row stored as JSON on apps/cases. */
export type CapabilityRow = {
	id: string;
	key: string;
	value: string;
};

export const apps = sqliteTable(
	"apps",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		prefix: text("prefix").notNull().default(""),
		context: text("context").notNull().default(""),
		iosBundleId: text("ios_bundle_id").notNull().default(""),
		iosAppStoreId: text("ios_app_store_id").notNull().default(""),
		androidApplicationId: text("android_application_id").notNull().default(""),
		/** JSON array of CapabilityRow */
		appiumCaps: text("appium_caps").notNull().default("[]"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [uniqueIndex("apps_prefix_idx").on(table.prefix)],
);

export const tags = sqliteTable(
	"tags",
	{
		id: text("id").primaryKey(),
		appId: text("app_id")
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
	},
	(table) => [uniqueIndex("tags_app_name_idx").on(table.appId, table.name)],
);

export const flows = sqliteTable("flows", {
	id: text("id").primaryKey(),
	appId: text("app_id")
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	instructions: text("instructions").notNull().default(""),
	expectedResult: text("expected_result").notNull().default(""),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const cases = sqliteTable("cases", {
	id: text("id").primaryKey(),
	appId: text("app_id")
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	number: integer("number").notNull(),
	title: text("title").notNull(),
	/** JSON array of CapabilityRow */
	appiumCaps: text("appium_caps").notNull().default("[]"),
	lastRunAt: integer("last_run_at"),
	lastRunStatus: text("last_run_status"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});

export const caseTags = sqliteTable(
	"case_tags",
	{
		caseId: text("case_id")
			.notNull()
			.references(() => cases.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.caseId, table.tagId] })],
);

export const caseFlows = sqliteTable("case_flows", {
	id: text("id").primaryKey(),
	caseId: text("case_id")
		.notNull()
		.references(() => cases.id, { onDelete: "cascade" }),
	position: integer("position").notNull(),
	instructions: text("instructions"),
	expectedResult: text("expected_result"),
	flowId: text("flow_id").references(() => flows.id, { onDelete: "set null" }),
});
