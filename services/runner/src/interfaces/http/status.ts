import {
	type YoqaStatusResponse,
	activeDeviceResponseSchema,
	yoqaStatusResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import { getArgentRuntimeStatus } from "../../domains/argent/runtime";
import { getActiveSessionInfo } from "../../domains/devices/active-session";
import {
	listProviders,
	resolveJudgeProviderAuth,
	resolveVisionProviderAuth,
} from "../../domains/providers/application";
import type { RunnerSettings } from "../../settings";

export function createStatusRoutes(settings: RunnerSettings) {
	const app = new Hono();

	app.get("/status", async (c) => {
		try {
			const runtime = await getArgentRuntimeStatus();
			const auth = await resolveVisionProviderAuth();
			const judgeAuth = await resolveJudgeProviderAuth();
			const providers = await listProviders();
			const activeProvider = auth ? (providers.find((p) => p.id === auth.id) ?? null) : null;
			const judgeProvider = judgeAuth
				? (providers.find((p) => p.id === judgeAuth.id) ?? null)
				: null;
			const activeDevice = getActiveSessionInfo();

			const body: YoqaStatusResponse = yoqaStatusResponseSchema.parse({
				runner: {
					ok: true,
					version: settings.version,
				},
				runtime: {
					ready: runtime.ready,
				},
				provider: {
					configured: auth != null,
					kind: activeProvider?.kind ?? auth?.kind ?? null,
					label: activeProvider?.label ?? null,
				},
				judge: {
					configured: judgeAuth != null,
					kind: judgeProvider?.kind ?? judgeAuth?.kind ?? null,
					label: judgeProvider?.label ?? null,
				},
				activeDevice: activeDevice ? activeDeviceResponseSchema.parse(activeDevice) : null,
			});
			return c.json(body);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return c.json({ error: "Failed to get status", detail: message }, 500);
		}
	});

	return app;
}
