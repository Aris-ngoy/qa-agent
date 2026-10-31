import { ensureAndroidSdkEnv } from "./domains/android-toolchain/android-sdk";
import { ensureHostToolPath } from "./domains/android-toolchain/host-path";
import { getCatalogDbPath, openCatalogDb } from "./domains/catalog/db";
import { quitEverySession } from "./domains/devices/active-session";
import { cancelRunsInProgress, recoverInterruptedRecordings } from "./domains/runs/application";
import { createApp } from "./interfaces/http/app";
import {
	type ControlWsData,
	controlWebSocket,
	isControlUpgrade,
} from "./interfaces/http/control-ws";
import { loadSettings } from "./settings";
import { stopRunner } from "./stop-runner";

// Finder/Dock launches get a stripped PATH — include Homebrew + agent CLIs before probes.
ensureHostToolPath();
// GUI apps also omit ANDROID_HOME; the Android Direct lane needs it even when adb is on PATH.
ensureAndroidSdkEnv();

const settings = loadSettings();
const startedAt = Date.now();

const dbPath = getCatalogDbPath();
openCatalogDb(dbPath);
void recoverInterruptedRecordings().catch((error) =>
	console.error("[yoqa-runner] could not recover interrupted recordings", error),
);
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

// Quit what Yoqa launched before exiting: a browser left open keeps its Kept profile locked.
const shutdown = stopRunner({
	quit: async () => {
		// Free the port and take no new connect while the sessions quit.
		void server.stop(true);
		await cancelRunsInProgress();
		await quitEverySession();
	},
	exit: (code) => process.exit(code),
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
