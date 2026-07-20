import { Hono } from "hono";
import type { RunnerSettings } from "../../settings";
import { createHealthRoutes } from "./health";

export function createApp(settings: RunnerSettings, startedAt = Date.now()) {
	const app = new Hono();

	app.route("/", createHealthRoutes(settings, startedAt));

	app.get("/", (c) =>
		c.json({
			name: "qa-agent-runner",
			docs: "GET /health",
		}),
	);

	return app;
}
