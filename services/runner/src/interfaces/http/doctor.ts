import {
	doctorRepairRequestSchema,
	doctorRepairResponseSchema,
	doctorReportSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import { getDoctorReport, repairDoctor } from "../../domains/doctor/application";

export function createDoctorRoutes() {
	const app = new Hono();

	app.get("/doctor", async (c) => {
		try {
			const report = await getDoctorReport();
			return c.json(doctorReportSchema.parse(report));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to run doctor", detail: message }, 500);
		}
	});

	app.post("/doctor/repair", async (c) => {
		try {
			const json: unknown = await c.req.json().catch(() => null);
			const body = doctorRepairRequestSchema.parse(json);
			const result = await repairDoctor(body.repairs);
			return c.json(doctorRepairResponseSchema.parse(result));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = /invalid|expected/i.test(message) ? 400 : 500;
			return c.json({ error: "Failed to repair", detail: message }, status);
		}
	});

	return app;
}
