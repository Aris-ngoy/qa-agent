import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RunnerSettings } from "../../settings";
import { createBuildsRoutes } from "./builds";
import { createCatalogRoutes } from "./catalog";
import { createDevicesRoutes } from "./devices";
import { createHealthRoutes } from "./health";
import { createProviderRoutes } from "./providers";
import { createRunsRoutes } from "./runs";
import { createRuntimeRoutes } from "./runtime";
import { createSessionRoutes } from "./session";
import { createStatusRoutes } from "./status";

export function createApp(settings: RunnerSettings, startedAt = Date.now()) {
	const app = new Hono();

	// Desktop Vite HMR (localhost:5173) and Electrobun webviews need CORS to call the runner.
	app.use(
		"*",
		cors({
			origin: (origin) => {
				if (!origin) return "*";
				if (
					origin.startsWith("http://localhost:") ||
					origin.startsWith("http://127.0.0.1:") ||
					origin.startsWith("views://") ||
					origin === "null"
				) {
					return origin;
				}
				return null;
			},
			allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
			allowHeaders: ["Content-Type", "Authorization"],
		}),
	);

	app.route("/", createHealthRoutes(settings, startedAt));
	app.route("/", createStatusRoutes(settings));
	app.route("/", createDevicesRoutes());
	app.route("/", createSessionRoutes());
	app.route("/", createRuntimeRoutes());
	app.route("/", createCatalogRoutes());
	app.route("/", createBuildsRoutes());
	app.route("/", createProviderRoutes());
	app.route("/", createRunsRoutes());

	app.get("/", (c) =>
		c.json({
			name: "yoqa-runner",
			docs: "GET /health · GET /status · GET /devices · POST /devices/connect · GET /screen · POST /action · /apps · /cases · /flows · /tags · /providers · /runs · /builds",
		}),
	);

	return app;
}
