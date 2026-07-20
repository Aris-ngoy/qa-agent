import { createApp } from "./interfaces/http/app";
import { loadSettings } from "./settings";

const settings = loadSettings();
const startedAt = Date.now();
const app = createApp(settings, startedAt);

const server = Bun.serve({
	hostname: settings.host,
	port: settings.port,
	fetch: app.fetch,
});

console.log(`[qa-agent-runner] listening on http://${server.hostname}:${server.port}`);
