import { z } from "zod";

export const healthResponseSchema = z.object({
	ok: z.literal(true),
	service: z.literal("qa-agent-runner"),
	version: z.string(),
	uptimeMs: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
