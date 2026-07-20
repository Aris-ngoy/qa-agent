import { healthResponseSchema } from "@qa-agent/runner-client";
import { Hono } from "hono";
import type { RunnerSettings } from "../../settings";

export function createHealthRoutes(settings: RunnerSettings, startedAt: number) {
	const app = new Hono();

	app.get("/health", (c) => {
		const body = healthResponseSchema.parse({
			ok: true as const,
			service: "qa-agent-runner" as const,
			version: settings.version,
			uptimeMs: Date.now() - startedAt,
		});
		return c.json(body);
	});

	return app;
}
