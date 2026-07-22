import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RunnerSettings } from "../../settings";
import { createDevicesRoutes } from "./devices";
import { createHealthRoutes } from "./health";
import { createRuntimeRoutes } from "./runtime";

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
	app.route("/", createDevicesRoutes());
	app.route("/", createRuntimeRoutes());

	app.get("/", (c) =>
		c.json({
			name: "yoqa-runner",
			docs: "GET /health · GET /devices?platform=ios|android · POST /devices/setup · GET /runtime · POST /runtime/ensure",
		}),
	);

	return app;
}
