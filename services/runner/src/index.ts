import { getCatalogDbPath, openCatalogDb } from "./domains/catalog/db";
import { createApp } from "./interfaces/http/app";
import { loadSettings } from "./settings";

const settings = loadSettings();
const startedAt = Date.now();

const dbPath = getCatalogDbPath();
openCatalogDb(dbPath);
console.log(`[yoqa-runner] catalog db → ${dbPath}`);

const app = createApp(settings, startedAt);

const server = Bun.serve({
	hostname: settings.host,
	port: settings.port,
	fetch: app.fetch,
});

console.log(`[yoqa-runner] listening on http://${server.hostname}:${server.port}`);
