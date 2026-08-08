import {
	aiProviderSchema,
	createProviderRequestSchema,
	listProviderModelsResponseSchema,
	listProvidersResponseSchema,
	probeProviderRequestSchema,
	probeProviderResponseSchema,
	updateProviderRequestSchema,
	validateProviderResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	ProviderNotFoundError,
	ProviderValidationError,
	createProvider,
	deleteProvider,
	getProvider,
	listProviderModels,
	listProviders,
	probeProvider,
	setDefaultProvider,
	updateProvider,
	validateProvider,
} from "../../domains/providers/application";

function providerErrorResponse(error: unknown): {
	status: 400 | 404 | 500;
	body: { error: string; detail?: string };
} {
	if (error instanceof ProviderValidationError) {
		return { status: 400, body: { error: error.message } };
	}
	if (error instanceof ProviderNotFoundError) {
		return { status: 404, body: { error: error.message } };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { status: 500, body: { error: "Provider request failed", detail: message } };
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

export function createProviderRoutes() {
	const app = new Hono();

	app.get("/providers", async (c) => {
		try {
			const providers = await listProviders();
			return c.json(listProvidersResponseSchema.parse({ providers }));
		} catch (error) {
			const { status, body } = providerErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.post("/providers/probe", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const parsed = probeProviderRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Invalid probe provider request", detail: parsed.error.message }, 400);
		}
		try {
			const result = await probeProvider(parsed.data);
			return c.json(probeProviderResponseSchema.parse(result));
		} catch (error) {
			const { status, body: err } = providerErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.post("/providers", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const parsed = createProviderRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid create provider request", detail: parsed.error.message },
				400,
			);
		}
		try {
			const provider = await createProvider(parsed.data);
			return c.json(aiProviderSchema.parse(provider), 201);
		} catch (error) {
			const { status, body: err } = providerErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.get("/providers/:id", async (c) => {
		const id = c.req.param("id");
		try {
			const provider = await getProvider(id);
			return c.json(aiProviderSchema.parse(provider));
		} catch (error) {
			const { status, body } = providerErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.get("/providers/:id/models", async (c) => {
		const id = c.req.param("id");
		try {
			const result = await listProviderModels(id);
			return c.json(listProviderModelsResponseSchema.parse(result));
		} catch (error) {
			const { status, body } = providerErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.patch("/providers/:id", async (c) => {
		const id = c.req.param("id");
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const parsed = updateProviderRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json(
				{ error: "Invalid update provider request", detail: parsed.error.message },
				400,
			);
		}
		try {
			const provider = await updateProvider(id, parsed.data);
			return c.json(aiProviderSchema.parse(provider));
		} catch (error) {
			const { status, body: err } = providerErrorResponse(error);
			return c.json(err, status);
		}
	});

	app.post("/providers/:id/default", async (c) => {
		const id = c.req.param("id");
		try {
			const provider = await setDefaultProvider(id);
			return c.json(aiProviderSchema.parse(provider));
		} catch (error) {
			const { status, body } = providerErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.post("/providers/:id/validate", async (c) => {
		const id = c.req.param("id");
		try {
			const result = await validateProvider(id);
			return c.json(validateProviderResponseSchema.parse(result));
		} catch (error) {
			const { status, body } = providerErrorResponse(error);
			return c.json(body, status);
		}
	});

	app.delete("/providers/:id", async (c) => {
		const id = c.req.param("id");
		try {
			await deleteProvider(id);
			return c.body(null, 204);
		} catch (error) {
			const { status, body } = providerErrorResponse(error);
			return c.json(body, status);
		}
	});

	return app;
}
