import { ensureRuntimeResponseSchema, runtimeStatusSchema } from "@yoqa/runner-client";
import { Hono } from "hono";
import { ensureRuntime, getRuntimeStatus } from "../../domains/appium/application";

export function createRuntimeRoutes() {
	const app = new Hono();

	app.get("/runtime", async (c) => {
		try {
			const status = await getRuntimeStatus();
			return c.json(runtimeStatusSchema.parse(status));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to read runtime status", detail: message }, 500);
		}
	});

	app.post("/runtime/ensure", async (c) => {
		try {
			const result = await ensureRuntime();
			return c.json(ensureRuntimeResponseSchema.parse(result));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: "Failed to ensure Appium runtime",
					detail: message,
				},
				500,
			);
		}
	});

	return app;
}
