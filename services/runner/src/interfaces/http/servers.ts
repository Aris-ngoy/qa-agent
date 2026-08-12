import { listServersResponseSchema, serverMutationResponseSchema } from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	listServers,
	restartServer,
	stopAllServers,
	stopServer,
} from "../../domains/servers/application";

export function createServersRoutes() {
	const app = new Hono();

	app.get("/servers", async (c) => {
		try {
			const body = await listServers();
			return c.json(listServersResponseSchema.parse(body));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to list servers", detail: message }, 500);
		}
	});

	app.post("/servers/stop-all", async (c) => {
		try {
			const body = await stopAllServers();
			return c.json(serverMutationResponseSchema.parse(body));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to stop servers", detail: message }, 500);
		}
	});

	app.post("/servers/:id/stop", async (c) => {
		const id = c.req.param("id");
		try {
			const body = await stopServer(id);
			return c.json(serverMutationResponseSchema.parse(body));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = /unknown server|cannot stop/i.test(message) ? 400 : 500;
			return c.json({ error: "Failed to stop server", detail: message }, status);
		}
	});

	app.post("/servers/:id/restart", async (c) => {
		const id = c.req.param("id");
		try {
			const body = await restartServer(id);
			return c.json(serverMutationResponseSchema.parse(body));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = /unknown server|cannot restart|no active/i.test(message) ? 400 : 500;
			return c.json({ error: "Failed to restart server", detail: message }, status);
		}
	});

	return app;
}
