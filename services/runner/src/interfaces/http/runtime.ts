import { ensureRuntimeResponseSchema, runtimeStatusSchema } from "@yoqa/runner-client";
import { Hono } from "hono";
import {
	ensureAgentDeviceRuntime,
	getAgentDeviceRuntimeStatus,
} from "../../domains/agent-device/runtime";

export function createRuntimeRoutes() {
	const app = new Hono();

	app.get("/runtime", async (c) => {
		try {
			const status = await getAgentDeviceRuntimeStatus();
			return c.json(runtimeStatusSchema.parse(status));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to read runtime status", detail: message }, 500);
		}
	});

	app.post("/runtime/ensure", async (c) => {
		try {
			const result = await ensureAgentDeviceRuntime();
			return c.json(ensureRuntimeResponseSchema.parse(result));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json(
				{
					error: "Failed to ensure agent-device runtime",
					detail: message,
				},
				500,
			);
		}
	});

	return app;
}
