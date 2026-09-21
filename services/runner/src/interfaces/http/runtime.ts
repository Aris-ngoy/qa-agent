import { ensureRuntimeResponseSchema, runtimeStatusSchema } from "@yoqa/runner-client";
import { Hono } from "hono";
import { ArgentError } from "../../domains/argent/cli";
import { ensureArgentRuntime, getArgentRuntimeStatus } from "../../domains/argent/runtime";

export function createRuntimeRoutes() {
	const app = new Hono();

	app.get("/runtime", async (c) => {
		try {
			const status = await getArgentRuntimeStatus();
			return c.json(runtimeStatusSchema.parse(status));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to read runtime status", detail: message }, 500);
		}
	});

	app.post("/runtime/ensure", async (c) => {
		let consent = false;
		try {
			const json = (await c.req.json().catch(() => null)) as { consent?: unknown } | null;
			consent = json?.consent === true;
		} catch {
			consent = false;
		}
		try {
			const result = await ensureArgentRuntime({ consent });
			return c.json(ensureRuntimeResponseSchema.parse(result));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (error instanceof ArgentError && error.code === "CONSENT_REQUIRED") {
				return c.json(
					{
						error: "Argent install needs your consent",
						detail: message,
						code: "CONSENT_REQUIRED",
					},
					428,
				);
			}
			return c.json(
				{
					error: "Failed to ensure Argent runtime",
					detail: message,
				},
				500,
			);
		}
	});

	return app;
}
