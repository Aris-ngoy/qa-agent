import { readFile } from "node:fs/promises";
import { createRunRequestSchema, listRunsResponseSchema, runSchema } from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	RunNotFoundError,
	RunValidationError,
	cancelRun,
	createRun,
	deleteRun,
	getRun,
	getRunStepScreenshotPath,
	listRuns,
} from "../../domains/runs/application";

function runErrorResponse(error: unknown): {
	status: 400 | 404 | 500;
	body: { error: string; detail?: string };
} {
	if (error instanceof RunValidationError) {
		return { status: 400, body: { error: error.message } };
	}
	if (error instanceof RunNotFoundError) {
		return { status: 404, body: { error: error.message } };
	}
	const message = error instanceof Error ? error.message : String(error);
	return { status: 500, body: { error: "Run request failed", detail: message } };
}

async function readJson(c: {
	req: { json: () => Promise<unknown> };
}): Promise<{ ok: true; json: unknown } | { ok: false }> {
	try {
		return { ok: true, json: await c.req.json() };
	} catch {
		return { ok: false };
	}
}

export function createRunsRoutes() {
	const app = new Hono();

	app.get("/runs", async (c) => {
		const appId = c.req.query("appId")?.trim();
		if (!appId) {
			return c.json({ error: "appId query parameter is required" }, 400);
		}
		try {
			const runs = await listRuns(appId);
			return c.json(listRunsResponseSchema.parse({ runs }));
		} catch (error) {
			const mapped = runErrorResponse(error);
			return c.json(mapped.body, mapped.status);
		}
	});

	app.post("/runs", async (c) => {
		const body = await readJson(c);
		if (!body.ok) {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		const parsed = createRunRequestSchema.safeParse(body.json);
		if (!parsed.success) {
			return c.json({ error: "Invalid create run request", detail: parsed.error.message }, 400);
		}
		try {
			const run = await createRun(parsed.data);
			return c.json(runSchema.parse(run), 201);
		} catch (error) {
			const mapped = runErrorResponse(error);
			return c.json(mapped.body, mapped.status);
		}
	});

	app.get("/runs/:runId", async (c) => {
		const runId = c.req.param("runId");
		try {
			const run = await getRun(runId);
			return c.json(runSchema.parse(run));
		} catch (error) {
			const mapped = runErrorResponse(error);
			return c.json(mapped.body, mapped.status);
		}
	});

	app.delete("/runs/:runId", async (c) => {
		const runId = c.req.param("runId");
		try {
			await deleteRun(runId);
			return c.body(null, 204);
		} catch (error) {
			const mapped = runErrorResponse(error);
			return c.json(mapped.body, mapped.status);
		}
	});

	app.post("/runs/:runId/cancel", async (c) => {
		const runId = c.req.param("runId");
		try {
			const run = await cancelRun(runId);
			return c.json(runSchema.parse(run));
		} catch (error) {
			const mapped = runErrorResponse(error);
			return c.json(mapped.body, mapped.status);
		}
	});

	app.get("/runs/:runId/steps/:stepId/screenshot", async (c) => {
		const runId = c.req.param("runId");
		const stepId = c.req.param("stepId");
		try {
			const path = await getRunStepScreenshotPath(runId, stepId);
			const bytes = await readFile(path);
			return new Response(bytes, {
				status: 200,
				headers: {
					"Content-Type": "image/png",
					"Cache-Control": "private, max-age=60",
				},
			});
		} catch (error) {
			const mapped = runErrorResponse(error);
			return c.json(mapped.body, mapped.status);
		}
	});

	return app;
}
