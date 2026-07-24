import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const providers = sqliteTable("providers", {
	id: text("id").primaryKey(),
	kind: text("kind").notNull(),
	label: text("label").notNull(),
	authMode: text("auth_mode").notNull().default("api_key"),
	enabled: integer("enabled").notNull().default(1),
	binaryPath: text("binary_path"),
	accentColor: text("accent_color").notNull().default("blue"),
	serverUrl: text("server_url"),
	baseUrl: text("base_url"),
	defaultModel: text("default_model"),
	isDefault: integer("is_default").notNull().default(0),
	apiKeyCiphertext: text("api_key_ciphertext"),
	apiKeyLast4: text("api_key_last4"),
	envCiphertext: text("env_ciphertext"),
	status: text("status").notNull().default("unchecked"),
	statusDetail: text("status_detail"),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
});
