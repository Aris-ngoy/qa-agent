import {
	type YoqaStatusResponse,
	activeDeviceResponseSchema,
	yoqaStatusResponseSchema,
} from "@yoqa/runner-client";
import { Hono } from "hono";
import { getRuntimeStatus } from "../../domains/appium/application";
import { getActiveSessionInfo } from "../../domains/devices/active-session";
import { listProviders, resolveActiveProviderAuth } from "../../domains/providers/application";
import type { RunnerSettings } from "../../settings";

export function createStatusRoutes(settings: RunnerSettings) {
	const app = new Hono();

	app.get("/status", async (c) => {
		try {
			const runtime = await getRuntimeStatus();
			const auth = await resolveActiveProviderAuth();
			const providers = await listProviders();
			const activeProvider = auth ? (providers.find((p) => p.id === auth.id) ?? null) : null;
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
