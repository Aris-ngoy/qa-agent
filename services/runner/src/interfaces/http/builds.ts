import {
	buildSchema,
	createBuildRequestSchema,
	listBuildsResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	BuildNotFoundError,
	BuildValidationError,
	createBuild,
	deleteBuild,
	listBuilds,
} from "../../domains/builds/application";

export function createBuildsRoutes() {
	const app = new Hono();

	app.get("/builds", async (c) => {
		const appId = c.req.query("appId") ?? undefined;
		const builds = await listBuilds(appId);
		return c.json(listBuildsResponseSchema.parse({ builds }));
	});

	app.post("/builds", async (c) => {
		let json: unknown;
		try {
			json = await c.req.json();
		} catch {
			return c.json({ error: "Request body must be JSON" }, 400);
		}
		const parsed = createBuildRequestSchema.safeParse(json);
		if (!parsed.success) {
			return c.json({ error: "Body must include path" }, 400);
		}
		try {
			const build = await createBuild(parsed.data);
			return c.json(buildSchema.parse(build), 201);
		} catch (error) {
			if (error instanceof BuildValidationError) {
				return c.json({ error: error.message }, 400);
			}
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to register build", detail: message }, 500);
		}
	});

	app.delete("/builds/:buildId", async (c) => {
		const buildId = c.req.param("buildId");
		try {
			await deleteBuild(buildId);
			return c.body(null, 204);
		} catch (error) {
			if (error instanceof BuildNotFoundError) {
				return c.json({ error: error.message }, 404);
			}
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to delete build", detail: message }, 500);
		}
	});

	return app;
}
