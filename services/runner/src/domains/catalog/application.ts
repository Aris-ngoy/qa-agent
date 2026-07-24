import {
	type Capability,
	type CaseFlowStep,
	type CaseRunStatus,
	type CaseScript,
	type CatalogApp,
	type CatalogCase,
	type CatalogFlow,
	type CatalogTag,
	type CreateAppRequest,
	type CreateCaseRequest,
	type CreateFlowRequest,
	type CreateTagRequest,
	type UpdateAppRequest,
	type UpdateCaseRequest,
	type UpdateFlowRequest,
	caseRunStatusSchema,
	caseScriptSchema,
} from "@yoqa/runner-client";
import { and, asc, desc, eq, max } from "drizzle-orm";
import { getCatalogDb } from "./db";
import { type CapabilityRow, apps, caseFlows, caseTags, cases, flows, tags } from "./schema";

function newId(prefix: string): string {
	return `${prefix}_${crypto.randomUUID()}`;
}

function parseCaseScript(raw: string | null | undefined): CaseScript | null {
	if (!raw) return null;
	try {
		const parsed: unknown = JSON.parse(raw);
		const result = caseScriptSchema.safeParse(parsed);
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

function parseCapabilities(raw: string): Capability[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		return parsed
			.filter(
				(item): item is CapabilityRow =>
					typeof item === "object" &&
					item !== null &&
					typeof (item as CapabilityRow).id === "string" &&
					typeof (item as CapabilityRow).key === "string" &&
					typeof (item as CapabilityRow).value === "string",
			)
			.map((item) => ({ id: item.id, key: item.key, value: item.value }));
	} catch {
		return [];
	}
}

function serializeCapabilities(caps: Capability[]): string {
	return JSON.stringify(caps.map((cap) => ({ id: cap.id, key: cap.key, value: cap.value })));
}

function mapApp(row: typeof apps.$inferSelect): CatalogApp {
	return {
		id: row.id,
		name: row.name,
		prefix: row.prefix || row.id,
		context: row.context,
		iosBundleId: row.iosBundleId,
		iosAppStoreId: row.iosAppStoreId,
		androidApplicationId: row.androidApplicationId,
		capabilities: parseCapabilities(row.appiumCaps),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function slugifyPrefix(name: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 32);
	return base || "app";
}

async function allocatePrefix(preferred: string, excludeId?: string): Promise<string> {
	const db = getCatalogDb();
	const rows = await db.select({ id: apps.id, prefix: apps.prefix }).from(apps);
	const used = new Set(rows.filter((r) => r.id !== excludeId && r.prefix).map((r) => r.prefix));
	let candidate = slugifyPrefix(preferred);
	let n = 2;
	while (used.has(candidate)) {
		candidate = `${slugifyPrefix(preferred)}-${n}`;
		n += 1;
	}
	return candidate;
}

function mapFlow(row: typeof flows.$inferSelect): CatalogFlow {
	return {
		id: row.id,
		appId: row.appId,
		name: row.name,
		instructions: row.instructions,
		expectedResult: row.expectedResult,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function mapTag(row: typeof tags.$inferSelect): CatalogTag {
	return {
		id: row.id,
		appId: row.appId,
		name: row.name,
	};
}

function parseRunStatus(value: string | null): CaseRunStatus | null {
	if (value === null) return null;
	const parsed = caseRunStatusSchema.safeParse(value);
	return parsed.success ? parsed.data : null;
}

async function loadCaseDetail(caseId: string): Promise<CatalogCase | null> {
	const db = getCatalogDb();
	const row = await db.query.cases.findFirst({
		where: eq(cases.id, caseId),
	});
	if (!row) return null;

	const tagRows = await db
		.select({ name: tags.name })
		.from(caseTags)
		.innerJoin(tags, eq(caseTags.tagId, tags.id))
		.where(eq(caseTags.caseId, caseId))
		.orderBy(asc(tags.name));

	const flowRows = await db
		.select()
		.from(caseFlows)
		.where(eq(caseFlows.caseId, caseId))
		.orderBy(asc(caseFlows.position));

	const steps: CaseFlowStep[] = [];
	for (const flowRow of flowRows) {
		if (flowRow.flowId) {
			const reusable = await db.query.flows.findFirst({
				where: eq(flows.id, flowRow.flowId),
			});
			steps.push({
				id: flowRow.id,
				instructions: reusable?.instructions ?? flowRow.instructions ?? "",
				expectedResult: reusable?.expectedResult ?? flowRow.expectedResult ?? "",
				flowId: flowRow.flowId,
			});
		} else {
			steps.push({
				id: flowRow.id,
				instructions: flowRow.instructions ?? "",
				expectedResult: flowRow.expectedResult ?? "",
				flowId: null,
			});
		}
	}

	const script = parseCaseScript(row.scriptJson);

	return {
		id: row.id,
		appId: row.appId,
		number: row.number,
		name: row.title,
		tags: tagRows.map((t) => t.name),
		flows: steps,
		capabilities: parseCapabilities(row.appiumCaps),
		hasScript: script !== null,
		scriptSavedAt: row.scriptSavedAt ?? null,
		script,
		lastRunAt: row.lastRunAt,
		lastRunStatus: parseRunStatus(row.lastRunStatus),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

async function ensureAppExists(appId: string): Promise<void> {
	const db = getCatalogDb();
	const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
	if (!app) {
		throw new CatalogNotFoundError("App not found");
	}
}

async function resolveTagsForApp(appId: string, tagNames: string[]): Promise<string[]> {
	const db = getCatalogDb();
	const tagIds: string[] = [];
	for (const rawName of tagNames) {
		const name = rawName.trim();
		if (!name) continue;
		const existing = await db.query.tags.findFirst({
			where: and(eq(tags.appId, appId), eq(tags.name, name)),
		});
		if (existing) {
			tagIds.push(existing.id);
			continue;
		}
		const id = newId("tag");
		await db.insert(tags).values({ id, appId, name });
		tagIds.push(id);
	}
	return tagIds;
}

async function replaceCaseTags(caseId: string, appId: string, tagNames: string[]): Promise<void> {
	const db = getCatalogDb();
	await db.delete(caseTags).where(eq(caseTags.caseId, caseId));
	const tagIds = await resolveTagsForApp(appId, tagNames);
	for (const tagId of tagIds) {
		await db.insert(caseTags).values({ caseId, tagId });
	}
}

async function replaceCaseFlows(
	caseId: string,
	flowInputs: Array<{
		id?: string;
		instructions?: string;
		expectedResult?: string;
		flowId?: string | null;
	}>,
): Promise<void> {
	const db = getCatalogDb();
	await db.delete(caseFlows).where(eq(caseFlows.caseId, caseId));
	let position = 0;
	for (const input of flowInputs) {
		await db.insert(caseFlows).values({
			id: input.id?.startsWith("cf_") ? input.id : newId("cf"),
			caseId,
			position,
			instructions: input.flowId ? null : (input.instructions ?? ""),
			expectedResult: input.flowId ? null : (input.expectedResult ?? ""),
			flowId: input.flowId ?? null,
		});
		position += 1;
	}
}

export class CatalogNotFoundError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CatalogNotFoundError";
	}
}

export class CatalogValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CatalogValidationError";
	}
}

export async function listApps(): Promise<CatalogApp[]> {
	const db = getCatalogDb();
	const rows = await db.select().from(apps).orderBy(asc(apps.name));
	return rows.map(mapApp);
}

export async function getApp(appId: string): Promise<CatalogApp | null> {
	const db = getCatalogDb();
	const row = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
	return row ? mapApp(row) : null;
}

export async function getAppByPrefix(prefix: string): Promise<CatalogApp | null> {
	const db = getCatalogDb();
	const trimmed = prefix.trim();
	if (!trimmed) return null;
	const byPrefix = await db.query.apps.findFirst({ where: eq(apps.prefix, trimmed) });
	if (byPrefix) return mapApp(byPrefix);
	return getApp(trimmed);
}

export async function createApp(input: CreateAppRequest): Promise<CatalogApp> {
	const name = input.name.trim();
	if (!name) {
		throw new CatalogValidationError("Application name is required");
	}
	const db = getCatalogDb();
	const now = Date.now();
	const id = newId("app");
	const prefix = await allocatePrefix(input.prefix?.trim() || name);
	await db.insert(apps).values({
		id,
		name,
		prefix,
		context: "",
		iosBundleId: "",
		iosAppStoreId: "",
		androidApplicationId: "",
		appiumCaps: "[]",
		createdAt: now,
		updatedAt: now,
	});
	const created = await getApp(id);
	if (!created) {
		throw new Error("Failed to create app");
	}
	return created;
}

export async function updateApp(appId: string, input: UpdateAppRequest): Promise<CatalogApp> {
	const db = getCatalogDb();
	const existing = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
	if (!existing) {
		throw new CatalogNotFoundError("App not found");
	}

	const name = input.name !== undefined ? input.name.trim() : existing.name;
	if (!name) {
		throw new CatalogValidationError("Application name is required");
	}

	const prefix =
		input.prefix !== undefined
			? await allocatePrefix(input.prefix.trim() || name, appId)
			: existing.prefix || (await allocatePrefix(name, appId));

	await db
		.update(apps)
		.set({
			name,
			prefix,
			context: input.context ?? existing.context,
			iosBundleId: input.iosBundleId ?? existing.iosBundleId,
			iosAppStoreId: input.iosAppStoreId ?? existing.iosAppStoreId,
			androidApplicationId: input.androidApplicationId ?? existing.androidApplicationId,
			appiumCaps:
				input.capabilities !== undefined
					? serializeCapabilities(input.capabilities)
					: existing.appiumCaps,
			updatedAt: Date.now(),
		})
		.where(eq(apps.id, appId));

	const updated = await getApp(appId);
	if (!updated) {
		throw new CatalogNotFoundError("App not found");
	}
	return updated;
}

export async function deleteApp(appId: string): Promise<void> {
	const db = getCatalogDb();
	const existing = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
	if (!existing) {
		throw new CatalogNotFoundError("App not found");
	}

	const caseRows = await db.select({ id: cases.id }).from(cases).where(eq(cases.appId, appId));
	for (const row of caseRows) {
		await db.delete(caseFlows).where(eq(caseFlows.caseId, row.id));
		await db.delete(caseTags).where(eq(caseTags.caseId, row.id));
	}
	await db.delete(cases).where(eq(cases.appId, appId));
	await db.delete(flows).where(eq(flows.appId, appId));
	await db.delete(tags).where(eq(tags.appId, appId));
	await db.delete(apps).where(eq(apps.id, appId));
}

export async function listCases(appId: string): Promise<CatalogCase[]> {
	await ensureAppExists(appId);
	const db = getCatalogDb();
	const rows = await db
		.select({ id: cases.id })
		.from(cases)
		.where(eq(cases.appId, appId))
		.orderBy(desc(cases.number));

	const result: CatalogCase[] = [];
	for (const row of rows) {
		const detail = await loadCaseDetail(row.id);
		if (detail) result.push(detail);
	}
	return result;
}

export async function getCase(caseId: string): Promise<CatalogCase | null> {
	return loadCaseDetail(caseId);
}

export async function createCase(appId: string, input: CreateCaseRequest): Promise<CatalogCase> {
	await ensureAppExists(appId);
	const name = input.name.trim();
	if (!name) {
		throw new CatalogValidationError("Test case name is required");
	}

	const db = getCatalogDb();
	const maxRows = await db
		.select({ maxNumber: max(cases.number) })
		.from(cases)
		.where(eq(cases.appId, appId));
	const maxNumber = maxRows[0]?.maxNumber ?? 0;

	const now = Date.now();
	const id = newId("case");
	const number = maxNumber + 1;

	await db.insert(cases).values({
		id,
		appId,
		number,
		title: name,
		appiumCaps: serializeCapabilities(input.capabilities ?? []),
		lastRunAt: null,
		lastRunStatus: null,
		createdAt: now,
		updatedAt: now,
	});

	const flowInputs =
		input.flows && input.flows.length > 0
			? input.flows
			: [{ instructions: "", expectedResult: "" }];
	await replaceCaseFlows(id, flowInputs);
	await replaceCaseTags(id, appId, input.tags ?? []);

	const created = await getCase(id);
	if (!created) {
		throw new Error("Failed to create case");
	}
	return created;
}

export async function updateCase(caseId: string, input: UpdateCaseRequest): Promise<CatalogCase> {
	const db = getCatalogDb();
	const existing = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
	if (!existing) {
		throw new CatalogNotFoundError("Case not found");
	}

	const name = input.name !== undefined ? input.name.trim() : existing.title;
	if (!name) {
		throw new CatalogValidationError("Test case name is required");
	}

	await db
		.update(cases)
		.set({
			title: name,
			appiumCaps:
				input.capabilities !== undefined
					? serializeCapabilities(input.capabilities)
					: existing.appiumCaps,
			...(input.script !== undefined
				? input.script === null
					? { scriptJson: null, scriptSavedAt: null }
					: {
							scriptJson: JSON.stringify({
								...input.script,
								savedAt: Date.now(),
							}),
							scriptSavedAt: Date.now(),
						}
				: {}),
			updatedAt: Date.now(),
		})
		.where(eq(cases.id, caseId));

	if (input.flows !== undefined) {
		const flowInputs =
			input.flows.length > 0 ? input.flows : [{ instructions: "", expectedResult: "" }];
		await replaceCaseFlows(caseId, flowInputs);
	}
	if (input.tags !== undefined) {
		await replaceCaseTags(caseId, existing.appId, input.tags);
	}

	const updated = await getCase(caseId);
	if (!updated) {
		throw new CatalogNotFoundError("Case not found");
	}
	return updated;
}

export async function deleteCase(caseId: string): Promise<void> {
	const db = getCatalogDb();
	const existing = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
	if (!existing) {
		throw new CatalogNotFoundError("Case not found");
	}
	await db.delete(cases).where(eq(cases.id, caseId));
}

export async function listFlows(appId: string): Promise<CatalogFlow[]> {
	await ensureAppExists(appId);
	const db = getCatalogDb();
	const rows = await db.select().from(flows).where(eq(flows.appId, appId)).orderBy(asc(flows.name));
	return rows.map(mapFlow);
}

export async function getFlow(flowId: string): Promise<CatalogFlow | null> {
	const db = getCatalogDb();
	const row = await db.query.flows.findFirst({ where: eq(flows.id, flowId) });
	return row ? mapFlow(row) : null;
}

export async function createFlow(appId: string, input: CreateFlowRequest): Promise<CatalogFlow> {
	await ensureAppExists(appId);
	const name = input.name.trim();
	if (!name) {
		throw new CatalogValidationError("Flow name is required");
	}
	const db = getCatalogDb();
	const now = Date.now();
	const id = newId("flow");
	await db.insert(flows).values({
		id,
		appId,
		name,
		instructions: input.instructions ?? "",
		expectedResult: input.expectedResult ?? "",
		createdAt: now,
		updatedAt: now,
	});
	const created = await getFlow(id);
	if (!created) {
		throw new Error("Failed to create flow");
	}
	return created;
}

export async function updateFlow(flowId: string, input: UpdateFlowRequest): Promise<CatalogFlow> {
	const db = getCatalogDb();
	const existing = await db.query.flows.findFirst({ where: eq(flows.id, flowId) });
	if (!existing) {
		throw new CatalogNotFoundError("Flow not found");
	}
	const name = input.name !== undefined ? input.name.trim() : existing.name;
	if (!name) {
		throw new CatalogValidationError("Flow name is required");
	}
	await db
		.update(flows)
		.set({
			name,
			instructions: input.instructions ?? existing.instructions,
			expectedResult: input.expectedResult ?? existing.expectedResult,
			updatedAt: Date.now(),
		})
		.where(eq(flows.id, flowId));
	const updated = await getFlow(flowId);
	if (!updated) {
		throw new CatalogNotFoundError("Flow not found");
	}
	return updated;
}

export async function deleteFlow(flowId: string): Promise<void> {
	const db = getCatalogDb();
	const existing = await db.query.flows.findFirst({ where: eq(flows.id, flowId) });
	if (!existing) {
		throw new CatalogNotFoundError("Flow not found");
	}
	await db.delete(flows).where(eq(flows.id, flowId));
}

export async function listTags(appId: string): Promise<CatalogTag[]> {
	await ensureAppExists(appId);
	const db = getCatalogDb();
	const rows = await db.select().from(tags).where(eq(tags.appId, appId)).orderBy(asc(tags.name));
	return rows.map(mapTag);
}

export async function createTag(appId: string, input: CreateTagRequest): Promise<CatalogTag> {
	await ensureAppExists(appId);
	const name = input.name.trim();
	if (!name) {
		throw new CatalogValidationError("Tag name is required");
	}
	const db = getCatalogDb();
	const existing = await db.query.tags.findFirst({
		where: and(eq(tags.appId, appId), eq(tags.name, name)),
	});
	if (existing) {
		return mapTag(existing);
	}
	const id = newId("tag");
	await db.insert(tags).values({ id, appId, name });
	return { id, appId, name };
}

export async function deleteTag(tagId: string): Promise<void> {
	const db = getCatalogDb();
	const existing = await db.query.tags.findFirst({ where: eq(tags.id, tagId) });
	if (!existing) {
		throw new CatalogNotFoundError("Tag not found");
	}
	await db.delete(tags).where(eq(tags.id, tagId));
}

/** Persist a replayable script on a case (from a successful agent run). */
export async function saveCaseScript(
	caseId: string,
	scriptJson: string,
	savedAt: number,
): Promise<void> {
	const db = getCatalogDb();
	const existing = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
	if (!existing) {
		throw new CatalogNotFoundError("Case not found");
	}
	await db
		.update(cases)
		.set({
			scriptJson,
			scriptSavedAt: savedAt,
			updatedAt: savedAt,
		})
		.where(eq(cases.id, caseId));
}

/** Raw script JSON for replay (null when missing). */
export async function getCaseScriptJson(caseId: string): Promise<string | null> {
	const db = getCatalogDb();
	const row = await db.query.cases.findFirst({ where: eq(cases.id, caseId) });
	return row?.scriptJson ?? null;
}
