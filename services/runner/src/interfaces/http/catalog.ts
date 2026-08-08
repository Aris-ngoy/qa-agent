import {
	catalogAppSchema,
	catalogCaseSchema,
	catalogFlowSchema,
	catalogTagSchema,
	createAppRequestSchema,
	createCaseRequestSchema,
	createFlowRequestSchema,
	createTagRequestSchema,
	listAppsResponseSchema,
	listCasesResponseSchema,
	listFlowsResponseSchema,
	listTagsResponseSchema,
	updateAppRequestSchema,
	updateCaseRequestSchema,
	updateFlowRequestSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	CatalogNotFoundError,
	CatalogValidationError,
	createApp,
	createCase,
	createFlow,
	createTag,
	deleteApp,
	deleteCase,
	deleteFlow,
	deleteTag,
	getApp,
	getCase,
	getFlow,
	listApps,
	listCases,
	listFlows,
	listTags,
	updateApp,
	updateCase,
	updateFlow,
} from "../../domains/catalog/application";

function catalogErrorResponse(error: unknown): {
	status: 400 | 404 | 500;
	body: { error: string; detail?: string };
} {
	if (error instanceof CatalogValidationError) {
		return { status: 400, body: { error: error.message } };
	}
	if (error instanceof CatalogNotFoundError) {
		return { status: 404, body: { error: error.message } };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { status: 500, body: { error: "Catalog request failed", detail: message } };
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<
	{ ok: true; json: unknown } | { ok: false }
> {
	try {
		return { ok: true, json: await c.req.json() };
	} catch {
		return { ok: false };
	}
}

export function createCatalogRoutes() {
	const app = new Hono();

	app.get("/apps", async (c) => {
		try {
			const apps = await listApps();
			return c.json(listAppsResponseSchema.parse({ apps }));
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.post("/apps", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = createAppRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Body must include name: string" }, 400);
		}
		try {
			const created = await createApp(parsed.data);
			return c.json(catalogAppSchema.parse(created), 201);
		} catch (error) {
			const { status, body: err } = catalogErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.get("/apps/:appId", async (c) => {
		try {
			const found = await getApp(c.req.param("appId"));
			if (!found) {
				return c.json({ error: "App not found" }, 404);
			}
			return c.json(catalogAppSchema.parse(found));
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.patch("/apps/:appId", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = updateAppRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Invalid app update body" }, 400);
		}
		try {
			const updated = await updateApp(c.req.param("appId"), parsed.data);
			return c.json(catalogAppSchema.parse(updated));
		} catch (error) {
			const { status, body: err } = catalogErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.delete("/apps/:appId", async (c) => {
		try {
			await deleteApp(c.req.param("appId"));
			return c.json({ ok: true as const });
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.get("/apps/:appId/cases", async (c) => {
		try {
			const cases = await listCases(c.req.param("appId"));
			return c.json(listCasesResponseSchema.parse({ cases }));
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.post("/apps/:appId/cases", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = createCaseRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Body must include name: string" }, 400);
		}
		try {
			const created = await createCase(c.req.param("appId"), parsed.data);
			return c.json(catalogCaseSchema.parse(created), 201);
		} catch (error) {
			const { status, body: err } = catalogErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.get("/cases/:caseId", async (c) => {
		try {
			const found = await getCase(c.req.param("caseId"));
			if (!found) {
				return c.json({ error: "Case not found" }, 404);
			}
			return c.json(catalogCaseSchema.parse(found));
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.patch("/cases/:caseId", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = updateCaseRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Invalid case update body" }, 400);
		}
		try {
			const updated = await updateCase(c.req.param("caseId"), parsed.data);
			return c.json(catalogCaseSchema.parse(updated));
		} catch (error) {
			const { status, body: err } = catalogErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.delete("/cases/:caseId", async (c) => {
		try {
			await deleteCase(c.req.param("caseId"));
			return c.json({ ok: true as const });
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.get("/apps/:appId/flows", async (c) => {
		try {
			const flows = await listFlows(c.req.param("appId"));
			return c.json(listFlowsResponseSchema.parse({ flows }));
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.post("/apps/:appId/flows", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = createFlowRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Body must include name: string" }, 400);
		}
		try {
			const created = await createFlow(c.req.param("appId"), parsed.data);
			return c.json(catalogFlowSchema.parse(created), 201);
		} catch (error) {
			const { status, body: err } = catalogErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.get("/flows/:flowId", async (c) => {
		try {
			const found = await getFlow(c.req.param("flowId"));
			if (!found) {
				return c.json({ error: "Flow not found" }, 404);
			}
			return c.json(catalogFlowSchema.parse(found));
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.patch("/flows/:flowId", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = updateFlowRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Invalid flow update body" }, 400);
		}
		try {
			const updated = await updateFlow(c.req.param("flowId"), parsed.data);
			return c.json(catalogFlowSchema.parse(updated));
		} catch (error) {
			const { status, body: err } = catalogErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.delete("/flows/:flowId", async (c) => {
		try {
			await deleteFlow(c.req.param("flowId"));
			return c.json({ ok: true as const });
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.get("/apps/:appId/tags", async (c) => {
		try {
			const tags = await listTags(c.req.param("appId"));
			return c.json(listTagsResponseSchema.parse({ tags }));
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.post("/apps/:appId/tags", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = createTagRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Body must include name: string" }, 400);
		}
		try {
			const created = await createTag(c.req.param("appId"), parsed.data);
			return c.json(catalogTagSchema.parse(created), 201);
		} catch (error) {
			const { status, body: err } = catalogErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.delete("/tags/:tagId", async (c) => {
		try {
			await deleteTag(c.req.param("tagId"));
			return c.json({ ok: true as const });
		} catch (error) {
			const { status, body } = catalogErrorResponse(error);
			return c.json(body, status);
		}
	});

	return app;
}
