import { readFile } from "node:fs/promises";
import { createRunRequestSchema, listRunsResponseSchema, runSchema } from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	RunNotFoundError,
	RunValidationError,
	cancelRun,
	createRun,
	deleteRun,
	deleteRunTestVideo,
	getRun,
	getRunStepScreenshotPath,
	getRunTestVideoPath,
	listRuns,
} from "../../domains/runs/application";

/**
 * Parse a single `bytes=start-end` Range header. Null when absent or malformed (serve the
 * whole file); "unsatisfiable" when it points past the end (answer 416).
 */
export function parseByteRange(
	header: string | undefined,
	size: number,
): { start: number; end: number } | "unsatisfiable" | null {
	const match = header?.match(/^bytes=(\d*)-(\d*)$/);
	if (!match) return null;
	const [, from, to] = match;
	if (from === "" && to === "") return null;
	if (size <= 0) return "unsatisfiable";
	let start: number;
	let end: number;
	if (from === "") {
		start = Math.max(0, size - Number(to));
		end = size - 1;
	} else {
		start = Number(from);
		end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
	}
	return start <= end && start < size ? { start, end } : "unsatisfiable";
}

/**
 * Serve an mp4, honouring a single Range request (a `<video>` seeks with them). The body is read
 * into memory, because a streamed or file-backed body loses its Content-Length and goes out
 * chunked, which WebKit's media loader will not play.
 */
export async function serveVideo(path: string, rangeHeader: string | undefined): Promise<Response> {
	const file = Bun.file(path);
	const range = parseByteRange(rangeHeader, file.size);
	const headers = {
		"Content-Type": "video/mp4",
		"Accept-Ranges": "bytes",
		"Cache-Control": "private, max-age=60",
	};
	if (range === "unsatisfiable") {
		return new Response(null, {
			status: 416,
			headers: { "Content-Range": `bytes */${file.size}` },
		});
	}
	if (range) {
		const bytes = await file.slice(range.start, range.end + 1).arrayBuffer();
		return new Response(bytes, {
			status: 206,
			headers: {
				...headers,
				"Content-Range": `bytes ${range.start}-${range.end}/${file.size}`,
				"Content-Length": String(bytes.byteLength),
			},
		});
	}
	const bytes = await file.arrayBuffer();
	return new Response(bytes, {
		status: 200,
		headers: { ...headers, "Content-Length": String(bytes.byteLength) },
	});
}

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

	app.delete("/runs/:runId/tests/:testId/video", async (c) => {
		try {
			await deleteRunTestVideo(c.req.param("runId"), c.req.param("testId"));
			return c.body(null, 204);
		} catch (error) {
			const mapped = runErrorResponse(error);
			return c.json(mapped.body, mapped.status);
		}
	});

	app.get("/runs/:runId/tests/:testId/video", async (c) => {
		try {
			const path = await getRunTestVideoPath(c.req.param("runId"), c.req.param("testId"));
			return await serveVideo(path, c.req.header("range"));
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
