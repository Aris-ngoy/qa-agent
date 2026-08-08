import { ensureHostToolPath } from "./domains/appium/host-path";
import { getCatalogDbPath, openCatalogDb } from "./domains/catalog/db";
import { createApp } from "./interfaces/http/app";
import {
	type ControlWsData,
	controlWebSocket,
	isControlUpgrade,
} from "./interfaces/http/control-ws";
import { loadSettings } from "./settings";

// Finder/Dock launches get a stripped PATH — include Homebrew + agent CLIs before probes.
ensureHostToolPath();

const settings = loadSettings();
const startedAt = Date.now();

const dbPath = getCatalogDbPath();
openCatalogDb(dbPath);
console.log(`[yoqa-runner] catalog db → ${dbPath}`);

const app = createApp(settings, startedAt);

const server = Bun.serve<ControlWsData>({
	hostname: settings.host,
	port: settings.port,
	// MJPEG proxy holds the HTTP connection open; default 10s idle kills the stream.
	idleTimeout: 0,
	async fetch(req, server) {
		const url = new URL(req.url);
		if (isControlUpgrade(url.pathname)) {
			const upgraded = server.upgrade(req, { data: { kind: "control" } });
			if (upgraded) {
				// Bun requires no Response when the socket was upgraded.
				return undefined as never;
			}
			return new Response("WebSocket upgrade failed", { status: 400 });
		}
		return app.fetch(req, server);
	},
	websocket: {
		open(ws) {
			if (ws.data.kind === "control") {
				controlWebSocket.open(ws);
			}
		},
		message(ws, message) {
			if (ws.data.kind === "control") {
				void controlWebSocket.message(ws, message);
			}
		},
		close(ws, code, reason) {
			if (ws.data.kind === "control") {
				controlWebSocket.close(ws, code, reason);
			}
		},
	},
});

console.log(`[yoqa-runner] listening on http://${server.hostname}:${server.port}`);
