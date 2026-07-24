import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const builds = sqliteTable("builds", {
	id: text("id").primaryKey(),
	appId: text("app_id"),
	path: text("path").notNull(),
	platform: text("platform").notNull().default("unknown"),
	name: text("name").notNull(),
	bundleId: text("bundle_id"),
	version: text("version"),
	createdAt: integer("created_at").notNull(),
});
