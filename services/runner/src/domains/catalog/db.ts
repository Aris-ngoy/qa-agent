import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as buildsSchema from "../builds/schema";
import * as providersSchema from "../providers/schema";
import * as runsSchema from "../runs/schema";
import * as schema from "./schema";

const drizzleSchema = { ...schema, ...providersSchema, ...runsSchema, ...buildsSchema };

export type CatalogDb = ReturnType<typeof drizzle<typeof drizzleSchema>>;

const YOQA_ROOT = join(homedir(), ".yoqa");
const DEFAULT_DB_PATH = join(YOQA_ROOT, "yoqa.db");

let catalogDb: CatalogDb | null = null;
let sqliteClient: Database | null = null;

function ensureSchema(sqlite: Database): void {
	sqlite.exec("PRAGMA foreign_keys = ON;");
	sqlite.exec(`
		CREATE TABLE IF NOT EXISTS apps (
			id TEXT PRIMARY KEY NOT NULL,
			name TEXT NOT NULL,
			prefix TEXT NOT NULL DEFAULT '',
			context TEXT NOT NULL DEFAULT '',
			ios_bundle_id TEXT NOT NULL DEFAULT '',
			ios_app_store_id TEXT NOT NULL DEFAULT '',
			android_application_id TEXT NOT NULL DEFAULT '',
			appium_caps TEXT NOT NULL DEFAULT '[]',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS tags (
			id TEXT PRIMARY KEY NOT NULL,
			app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
			name TEXT NOT NULL
		);
		CREATE UNIQUE INDEX IF NOT EXISTS tags_app_name_idx ON tags(app_id, name);

		CREATE TABLE IF NOT EXISTS flows (
			id TEXT PRIMARY KEY NOT NULL,
			app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			instructions TEXT NOT NULL DEFAULT '',
			expected_result TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS cases (
			id TEXT PRIMARY KEY NOT NULL,
			app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
			number INTEGER NOT NULL,
			title TEXT NOT NULL,
			appium_caps TEXT NOT NULL DEFAULT '[]',
			script_json TEXT,
			script_saved_at INTEGER,
			last_run_at INTEGER,
			last_run_status TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS case_tags (
			case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
			tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
			PRIMARY KEY (case_id, tag_id)
		);

		CREATE TABLE IF NOT EXISTS case_flows (
			id TEXT PRIMARY KEY NOT NULL,
			case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
			position INTEGER NOT NULL,
			instructions TEXT,
			expected_result TEXT,
			flow_id TEXT REFERENCES flows(id) ON DELETE SET NULL
		);

		CREATE TABLE IF NOT EXISTS providers (
			id TEXT PRIMARY KEY NOT NULL,
			kind TEXT NOT NULL,
			label TEXT NOT NULL,
			auth_mode TEXT NOT NULL DEFAULT 'api_key',
			enabled INTEGER NOT NULL DEFAULT 1,
			binary_path TEXT,
			accent_color TEXT NOT NULL DEFAULT 'blue',
			server_url TEXT,
			base_url TEXT,
			default_model TEXT,
			is_default INTEGER NOT NULL DEFAULT 0,
			api_key_ciphertext TEXT,
			api_key_last4 TEXT,
			env_ciphertext TEXT,
			status TEXT NOT NULL DEFAULT 'unchecked',
			status_detail TEXT,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS runs (
			id TEXT PRIMARY KEY NOT NULL,
			app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
			device_id TEXT NOT NULL,
			platform TEXT NOT NULL,
			build_id TEXT,
			status TEXT NOT NULL,
			execution_mode TEXT NOT NULL DEFAULT 'auto',
			error TEXT,
			created_at INTEGER NOT NULL,
			started_at INTEGER,
			finished_at INTEGER
		);

		CREATE TABLE IF NOT EXISTS run_tests (
			id TEXT PRIMARY KEY NOT NULL,
			run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
			case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
			status TEXT NOT NULL,
			execution_mode TEXT,
			error TEXT,
			started_at INTEGER,
			finished_at INTEGER,
			current_command TEXT
		);

		CREATE TABLE IF NOT EXISTS run_steps (
			id TEXT PRIMARY KEY NOT NULL,
			run_test_id TEXT NOT NULL REFERENCES run_tests(id) ON DELETE CASCADE,
			idx INTEGER NOT NULL,
			action_json TEXT NOT NULL DEFAULT '{}',
			screenshot_uri TEXT,
			ok INTEGER NOT NULL DEFAULT 0,
			latency_ms INTEGER NOT NULL DEFAULT 0,
			detail TEXT,
			command TEXT,
			created_at INTEGER NOT NULL
		);

		CREATE TABLE IF NOT EXISTS builds (
			id TEXT PRIMARY KEY NOT NULL,
			app_id TEXT REFERENCES apps(id) ON DELETE SET NULL,
			path TEXT NOT NULL,
			platform TEXT NOT NULL DEFAULT 'unknown',
			name TEXT NOT NULL,
			bundle_id TEXT,
			version TEXT,
			created_at INTEGER NOT NULL
		);
	`);

	migrateProvidersTable(sqlite);
	migrateAppsPrefix(sqlite);
	migrateCaseScripts(sqlite);
	migrateRunExecutionMode(sqlite);
	migrateRunCommands(sqlite);
}

function tableColumns(sqlite: Database, table: string): Set<string> {
	const rows = sqlite.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
	return new Set(rows.map((row) => row.name));
}

function addColumnIfMissing(
	sqlite: Database,
	table: string,
	column: string,
	definition: string,
	existing: Set<string>,
): void {
	if (existing.has(column)) return;
	sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
	existing.add(column);
}

function migrateCaseScripts(sqlite: Database): void {
	const existing = tableColumns(sqlite, "cases");
	if (existing.size === 0) return;
	addColumnIfMissing(sqlite, "cases", "script_json", "script_json TEXT", existing);
	addColumnIfMissing(sqlite, "cases", "script_saved_at", "script_saved_at INTEGER", existing);
}

function migrateRunExecutionMode(sqlite: Database): void {
	const runCols = tableColumns(sqlite, "runs");
	if (runCols.size > 0) {
		addColumnIfMissing(
			sqlite,
			"runs",
			"execution_mode",
			"execution_mode TEXT NOT NULL DEFAULT 'auto'",
			runCols,
		);
	}
	const testCols = tableColumns(sqlite, "run_tests");
	if (testCols.size > 0) {
		addColumnIfMissing(sqlite, "run_tests", "execution_mode", "execution_mode TEXT", testCols);
	}
}

function migrateRunCommands(sqlite: Database): void {
	const testCols = tableColumns(sqlite, "run_tests");
	if (testCols.size > 0) {
		addColumnIfMissing(sqlite, "run_tests", "current_command", "current_command TEXT", testCols);
	}
	const stepCols = tableColumns(sqlite, "run_steps");
	if (stepCols.size > 0) {
		addColumnIfMissing(sqlite, "run_steps", "command", "command TEXT", stepCols);
	}
}

function migrateProvidersTable(sqlite: Database): void {
	const existing = tableColumns(sqlite, "providers");
	if (existing.size === 0) return;

	addColumnIfMissing(
		sqlite,
		"providers",
		"auth_mode",
		"auth_mode TEXT NOT NULL DEFAULT 'api_key'",
		existing,
	);
	addColumnIfMissing(
		sqlite,
		"providers",
		"enabled",
		"enabled INTEGER NOT NULL DEFAULT 1",
		existing,
	);
	addColumnIfMissing(sqlite, "providers", "binary_path", "binary_path TEXT", existing);
	addColumnIfMissing(
		sqlite,
		"providers",
		"accent_color",
		"accent_color TEXT NOT NULL DEFAULT 'blue'",
		existing,
	);
	addColumnIfMissing(sqlite, "providers", "server_url", "server_url TEXT", existing);
	addColumnIfMissing(sqlite, "providers", "env_ciphertext", "env_ciphertext TEXT", existing);
	addColumnIfMissing(sqlite, "providers", "status_detail", "status_detail TEXT", existing);

	sqlite.exec("DROP INDEX IF EXISTS providers_kind_idx");

	// Recreate table when legacy NOT NULL key columns block CLI-only instances.
	const info = sqlite.query("PRAGMA table_info(providers)").all() as Array<{
		name: string;
		notnull: number;
	}>;
	const keyCol = info.find((col) => col.name === "api_key_ciphertext");
	if (keyCol && keyCol.notnull === 1) {
		sqlite.exec(`
			CREATE TABLE providers_migrated (
				id TEXT PRIMARY KEY NOT NULL,
				kind TEXT NOT NULL,
				label TEXT NOT NULL,
				auth_mode TEXT NOT NULL DEFAULT 'api_key',
				enabled INTEGER NOT NULL DEFAULT 1,
				binary_path TEXT,
				accent_color TEXT NOT NULL DEFAULT 'blue',
				server_url TEXT,
				base_url TEXT,
				default_model TEXT,
				is_default INTEGER NOT NULL DEFAULT 0,
				api_key_ciphertext TEXT,
				api_key_last4 TEXT,
				env_ciphertext TEXT,
				status TEXT NOT NULL DEFAULT 'unchecked',
				status_detail TEXT,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			INSERT INTO providers_migrated (
				id, kind, label, auth_mode, enabled, binary_path, accent_color, server_url,
				base_url, default_model, is_default, api_key_ciphertext, api_key_last4,
				env_ciphertext, status, status_detail, created_at, updated_at
			)
			SELECT
				id, kind, label,
				COALESCE(auth_mode, 'api_key'),
				COALESCE(enabled, 1),
				binary_path,
				COALESCE(accent_color, 'blue'),
				server_url,
				base_url, default_model, is_default,
				api_key_ciphertext, api_key_last4,
				env_ciphertext, status, status_detail, created_at, updated_at
			FROM providers;
			DROP TABLE providers;
			ALTER TABLE providers_migrated RENAME TO providers;
		`);
	}
}

function slugifyPrefix(name: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 32);
	return base || "app";
}

function migrateAppsPrefix(sqlite: Database): void {
	const existing = tableColumns(sqlite, "apps");
	if (existing.size === 0) return;
	addColumnIfMissing(sqlite, "apps", "prefix", "prefix TEXT NOT NULL DEFAULT ''", existing);
	sqlite.exec(
		"CREATE UNIQUE INDEX IF NOT EXISTS apps_prefix_idx ON apps(prefix) WHERE prefix != ''",
	);

	const rows = sqlite.query("SELECT id, name, prefix FROM apps").all() as Array<{
		id: string;
		name: string;
		prefix: string;
	}>;
	const used = new Set(rows.map((r) => r.prefix).filter(Boolean));
	for (const row of rows) {
		if (row.prefix) continue;
		let candidate = slugifyPrefix(row.name);
		let n = 2;
		while (used.has(candidate)) {
			candidate = `${slugifyPrefix(row.name)}-${n}`;
			n += 1;
		}
		used.add(candidate);
		sqlite.run("UPDATE apps SET prefix = ? WHERE id = ?", [candidate, row.id]);
	}
}

export function getCatalogDbPath(): string {
	return process.env.YOQA_DB_PATH ?? DEFAULT_DB_PATH;
}

export function openCatalogDb(dbPath = getCatalogDbPath()): CatalogDb {
	if (catalogDb) {
		return catalogDb;
	}

	mkdirSync(dirname(dbPath), { recursive: true });
	const sqlite = new Database(dbPath, { create: true });
	ensureSchema(sqlite);
	sqliteClient = sqlite;
	catalogDb = drizzle(sqlite, { schema: drizzleSchema });
	return catalogDb;
}

export function getCatalogDb(): CatalogDb {
	if (!catalogDb) {
		return openCatalogDb();
	}
	return catalogDb;
}

export function closeCatalogDb(): void {
	sqliteClient?.close();
	sqliteClient = null;
	catalogDb = null;
}
