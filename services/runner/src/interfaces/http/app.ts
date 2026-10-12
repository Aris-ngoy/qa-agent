import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RunnerSettings } from "../../settings";
import { createBuildsRoutes } from "./builds";
import { createCatalogRoutes } from "./catalog";
import { createDevicesRoutes } from "./devices";
import { createDoctorRoutes } from "./doctor";
import { createHealthRoutes } from "./health";
import { createIosSigningRoutes } from "./ios-signing";
import { createProviderRoutes } from "./providers";
import { createRunsRoutes } from "./runs";
import { createServersRoutes } from "./servers";
import { createSessionRoutes } from "./session";
import { createStatusRoutes } from "./status";

/** Which runner process answered; the desktop logs it with a failed request. */
export const RUNNER_PID_HEADER = "X-Yoqa-Runner-Pid";

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
			exposeHeaders: [RUNNER_PID_HEADER],
		}),
	);

	// Every answer is live state: never let a webview reuse one (a 410 is cacheable by default).
	// The pid tells a client which runner process answered.
	app.use("*", async (c, next) => {
		await next();
		if (c.res.status === 101) return;
		try {
			c.res.headers.set("Cache-Control", "no-store");
			c.res.headers.set(RUNNER_PID_HEADER, String(process.pid));
		} catch {
			// A proxied upstream response can have immutable headers; it is a stream, not cached state.
		}
	});

	app.route("/", createHealthRoutes(settings, startedAt));
	app.route("/", createStatusRoutes(settings));
	app.route("/", createDevicesRoutes());
	app.route("/", createSessionRoutes());
	app.route("/", createServersRoutes());
	app.route("/", createDoctorRoutes());
	app.route("/", createIosSigningRoutes());
	app.route("/", createCatalogRoutes());
	app.route("/", createBuildsRoutes());
	app.route("/", createProviderRoutes());
	app.route("/", createRunsRoutes());

	app.get("/", (c) =>
		c.json({
			name: "yoqa-runner",
			docs: "GET /health · GET /status · GET /doctor · /ios/signing · GET /servers · GET /devices · POST /devices/connect · GET /screen · GET /screenshot/image · GET /stream.mjpeg · WS /ws/control · POST /action · /apps · /cases · /flows · /tags · /providers · /runs · /builds",
		}),
	);

	return app;
}
