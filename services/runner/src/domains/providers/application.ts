import {
	type AiProvider,
	type CreateProviderRequest,
	type ListProviderModelsResponse,
	type ProbeProviderRequest,
	type ProbeProviderResponse,
	type ProviderAccentColor,
	type ProviderAuthMode,
	type ProviderKind,
	type ProviderStatus,
	type UpdateProviderRequest,
	providerAccentColorSchema,
	providerAuthModeSchema,
	providerKindSchema,
	providerStatusSchema,
} from "@yoqa/runner-client";
import { and, asc, eq } from "drizzle-orm";
import { getCatalogDb } from "../catalog/db";
import { getDriver } from "./drivers";
import { providers } from "./schema";
import {
	apiKeyLast4,
	decryptApiKey,
	decryptEnvMap,
	encryptApiKey,
	encryptEnvMap,
	envKeyNames,
} from "./secrets";

/** Legacy Settings rows used `gemini-cli` before Antigravity replaced it. */
function parseProviderKind(raw: string): ProviderKind {
	const normalized = raw === "gemini-cli" ? "antigravity" : raw;
	return providerKindSchema.parse(normalized);
}

export class ProviderValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderValidationError";
	}
}

export class ProviderNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderNotFoundError";
	}
}

export type ActiveProviderAuth = {
	id: string;
	kind: ProviderKind;
	authMode: ProviderAuthMode;
	apiKey: string | null;
	baseUrl: string | null;
	serverUrl: string | null;
	defaultModel: string | null;
	binaryPath: string | null;
	env: Record<string, string>;
};

function newId(): string {
	return `prov_${crypto.randomUUID()}`;
}

function defaultAuthMode(kind: ProviderKind): ProviderAuthMode {
	const modes = getDriver(kind).authModes;
	return modes[0] ?? "api_key";
}

async function loadEnv(row: typeof providers.$inferSelect): Promise<Record<string, string>> {
	if (!row.envCiphertext) return {};
	try {
		return await decryptEnvMap(row.envCiphertext);
	} catch {
		return {};
	}
}

async function mapProvider(row: typeof providers.$inferSelect): Promise<AiProvider> {
	const kind = parseProviderKind(row.kind);
	const status = providerStatusSchema.parse(row.status);
	const authMode = providerAuthModeSchema.parse(row.authMode ?? "api_key");
	const accentColor = providerAccentColorSchema.parse(row.accentColor ?? "blue");
	const env = await loadEnv(row);
	const enabled = row.enabled !== 0;

	let effectiveStatus: ProviderStatus = status;
	if (!enabled) {
		effectiveStatus = "disabled";
	}

	return {
		id: row.id,
		kind,
		label: row.label,
		authMode,
		enabled,
		binaryPath: row.binaryPath,
		accentColor,
		serverUrl: row.serverUrl,
		baseUrl: row.baseUrl,
		defaultModel: row.defaultModel,
		isDefault: row.isDefault === 1,
		apiKeyLast4: row.apiKeyLast4,
		envKeys: envKeyNames(env),
		status: effectiveStatus,
		statusDetail: row.statusDetail,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function clearDefaultFlags(exceptId?: string): Promise<void> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers);
	for (const row of rows) {
		if (exceptId && row.id === exceptId) continue;
		if (row.isDefault === 1) {
			await db
				.update(providers)
				.set({ isDefault: 0, updatedAt: Date.now() })
				.where(eq(providers.id, row.id));
		}
	}
}

export async function listProviders(): Promise<AiProvider[]> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers).orderBy(asc(providers.createdAt));
	return Promise.all(rows.map(mapProvider));
}

export async function getProvider(id: string): Promise<AiProvider> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ProviderNotFoundError(`Provider not found: ${id}`);
	}
	return mapProvider(row);
}

export async function probeProvider(request: ProbeProviderRequest): Promise<ProbeProviderResponse> {
	const kind = parseProviderKind(request.kind);
	const driver = getDriver(kind);
	const result = await driver.probe(request.binaryPath);
	return {
		found: result.found,
		version: result.version,
		authenticated: result.authenticated,
		detail: result.detail,
		binaryPath: result.binaryPath,
	};
}

function requireCredentialForCreate(
	kind: ProviderKind,
	authMode: ProviderAuthMode,
	apiKey: string | undefined,
	env: Record<string, string> | undefined,
): void {
	const driver = getDriver(kind);
	if (!driver.authModes.includes(authMode)) {
		throw new ProviderValidationError(`${driver.label} does not support auth mode "${authMode}"`);
	}
	if (authMode === "cli") {
		return;
	}
	const hasKey = Boolean(apiKey?.trim());
	const hasEnvHint = driver.envHints.some((name) => Boolean(env?.[name]?.trim()));
	if (!hasKey && !hasEnvHint) {
		throw new ProviderValidationError(
			authMode === "token"
				? "A token is required (paste token or set COPILOT_GITHUB_TOKEN / GH_TOKEN)"
				: "An API key is required",
		);
	}
}

export async function createProvider(request: CreateProviderRequest): Promise<AiProvider> {
	const kind = parseProviderKind(request.kind);
	const driver = getDriver(kind);
	const authMode = providerAuthModeSchema.parse(request.authMode ?? defaultAuthMode(kind));
	requireCredentialForCreate(kind, authMode, request.apiKey, request.env);

	const db = getCatalogDb();
	const now = Date.now();
	const id = newId();
	const all = await db.select().from(providers);
	const setAsDefault = request.setAsDefault === true || all.length === 0;
	const accentColor: ProviderAccentColor = providerAccentColorSchema.parse(
		request.accentColor ?? "blue",
	);
	const enabled = request.enabled !== false;

	if (setAsDefault) {
		await clearDefaultFlags();
	}

	const apiKey = request.apiKey?.trim() || null;
	const ciphertext = apiKey ? await encryptApiKey(apiKey) : null;
	const last4 = apiKey ? apiKeyLast4(apiKey) : null;
	const env = request.env ?? {};
	const envCiphertext = Object.keys(env).length > 0 ? await encryptEnvMap(env) : null;

	await db.insert(providers).values({
		id,
		kind,
		label: request.label?.trim() || driver.label,
		authMode,
		enabled: enabled ? 1 : 0,
		binaryPath: request.binaryPath?.trim() || driver.defaultBinary,
		accentColor,
		serverUrl: request.serverUrl?.trim() || null,
		baseUrl: request.baseUrl?.trim() || null,
		defaultModel: request.defaultModel?.trim() || null,
		isDefault: setAsDefault ? 1 : 0,
		apiKeyCiphertext: ciphertext,
		apiKeyLast4: last4,
		envCiphertext,
		status: enabled ? "unchecked" : "disabled",
		statusDetail: null,
		createdAt: now,
		updatedAt: now,
	});

	return getProvider(id);
}

export async function updateProvider(
	id: string,
	request: UpdateProviderRequest,
): Promise<AiProvider> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ProviderNotFoundError(`Provider not found: ${id}`);
	}

	const kind = parseProviderKind(row.kind);
	const patch: Partial<typeof providers.$inferInsert> = {
		updatedAt: Date.now(),
	};

	if (request.label !== undefined) {
		const label = request.label.trim();
		if (!label) throw new ProviderValidationError("Label cannot be empty");
		patch.label = label;
	}
	if (request.authMode !== undefined) {
		const authMode = providerAuthModeSchema.parse(request.authMode);
		if (!getDriver(kind).authModes.includes(authMode)) {
			throw new ProviderValidationError(
				`${getDriver(kind).label} does not support auth mode "${authMode}"`,
			);
		}
		patch.authMode = authMode;
	}
	if (request.binaryPath !== undefined) {
		patch.binaryPath = request.binaryPath?.trim() || null;
	}
	if (request.accentColor !== undefined) {
		patch.accentColor = providerAccentColorSchema.parse(request.accentColor);
	}
	if (request.serverUrl !== undefined) {
		patch.serverUrl = request.serverUrl?.trim() || null;
	}
	if (request.baseUrl !== undefined) {
		patch.baseUrl = request.baseUrl?.trim() || null;
	}
	if (request.defaultModel !== undefined) {
		patch.defaultModel = request.defaultModel?.trim() || null;
	}
	if (request.apiKey !== undefined) {
		const apiKey = request.apiKey.trim();
		if (!apiKey) throw new ProviderValidationError("API key cannot be empty");
		patch.apiKeyCiphertext = await encryptApiKey(apiKey);
		patch.apiKeyLast4 = apiKeyLast4(apiKey);
		patch.status = "unchecked";
		patch.statusDetail = null;
	}
	if (request.env !== undefined) {
		if (request.env === null || Object.keys(request.env).length === 0) {
			patch.envCiphertext = null;
		} else {
			patch.envCiphertext = await encryptEnvMap(request.env);
		}
	}
	if (request.enabled !== undefined) {
		patch.enabled = request.enabled ? 1 : 0;
		if (!request.enabled) {
			patch.status = "disabled";
			patch.statusDetail = "Disabled in YoQA settings";
		} else if (row.status === "disabled") {
			patch.status = "unchecked";
			patch.statusDetail = null;
		}
	}

	if (request.setAsDefault === true) {
		await clearDefaultFlags(id);
		patch.isDefault = 1;
	}

	await db.update(providers).set(patch).where(eq(providers.id, id));

	if (request.validate === true) {
		return (await validateProvider(id)).provider;
	}

	return getProvider(id);
}

export async function setDefaultProvider(id: string): Promise<AiProvider> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
	if (!rows[0]) {
		throw new ProviderNotFoundError(`Provider not found: ${id}`);
	}
	await clearDefaultFlags(id);
	await db
		.update(providers)
		.set({ isDefault: 1, updatedAt: Date.now() })
		.where(eq(providers.id, id));
	return getProvider(id);
}

export async function deleteProvider(id: string): Promise<void> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ProviderNotFoundError(`Provider not found: ${id}`);
	}
	const wasDefault = row.isDefault === 1;
	await db.delete(providers).where(eq(providers.id, id));

	if (wasDefault) {
		const remaining = await db.select().from(providers).orderBy(asc(providers.createdAt)).limit(1);
		const next = remaining[0];
		if (next) {
			await db
				.update(providers)
				.set({ isDefault: 1, updatedAt: Date.now() })
				.where(eq(providers.id, next.id));
		}
	}
}

async function buildValidateInput(row: typeof providers.$inferSelect) {
	const apiKey = row.apiKeyCiphertext ? await decryptApiKey(row.apiKeyCiphertext) : null;
	const env = await loadEnv(row);
	return {
		apiKey,
		baseUrl: row.baseUrl,
		serverUrl: row.serverUrl,
		binaryPath: row.binaryPath,
		env,
	};
}

export async function validateProvider(
	id: string,
): Promise<{ ok: boolean; provider: AiProvider; message: string }> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ProviderNotFoundError(`Provider not found: ${id}`);
	}

	if (row.enabled === 0) {
		await db
			.update(providers)
			.set({
				status: "disabled",
				statusDetail: "Disabled in YoQA settings",
				updatedAt: Date.now(),
			})
			.where(eq(providers.id, id));
		const provider = await getProvider(id);
		return { ok: false, provider, message: "Provider is disabled" };
	}

	const kind = parseProviderKind(row.kind);
	const driver = getDriver(kind);
	const input = await buildValidateInput(row);
	const result = await driver.validate(input);

	await db
		.update(providers)
		.set({
			status: result.status,
			statusDetail: result.message,
			updatedAt: Date.now(),
		})
		.where(eq(providers.id, id));

	const provider = await getProvider(id);
	return { ok: result.ok, provider, message: result.message };
}

export async function listProviderModels(id: string): Promise<ListProviderModelsResponse> {
	const db = getCatalogDb();
	const rows = await db.select().from(providers).where(eq(providers.id, id)).limit(1);
	const row = rows[0];
	if (!row) {
		throw new ProviderNotFoundError(`Provider not found: ${id}`);
	}
	const kind = parseProviderKind(row.kind);
	const driver = getDriver(kind);
	const input = await buildValidateInput(row);
	return driver.listModels(input);
}

/**
 * Resolve credentials for the default enabled provider.
 * Used by future `runs create` orchestration — not exposed over HTTP.
 */
export async function resolveActiveProviderAuth(): Promise<ActiveProviderAuth | null> {
	const db = getCatalogDb();
	const defaults = await db
		.select()
		.from(providers)
		.where(and(eq(providers.isDefault, 1), eq(providers.enabled, 1)))
		.limit(1);
	let row = defaults[0];

	if (!row) {
		const any = await db
			.select()
			.from(providers)
			.where(eq(providers.enabled, 1))
			.orderBy(asc(providers.createdAt))
			.limit(1);
		row = any[0];
	}
	if (!row) {
		return null;
	}

	const kind = parseProviderKind(row.kind);
	const authMode = providerAuthModeSchema.parse(row.authMode ?? "api_key");
	const apiKey = row.apiKeyCiphertext ? await decryptApiKey(row.apiKeyCiphertext) : null;
	const env = await loadEnv(row);
	return {
		id: row.id,
		kind,
		authMode,
		apiKey,
		baseUrl: row.baseUrl,
		serverUrl: row.serverUrl,
		defaultModel: row.defaultModel,
		binaryPath: row.binaryPath,
		env,
	};
}
