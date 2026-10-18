/**
 * Start the Yoqa runner on a throwaway catalog and seed it with one app, one test case,
 * and one finished web Run. Playwright waits for `GET /runs/<seeded Run>` before the tests.
 */
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNNER_PORT, RUNNER_URL, SEED } from "./harness";

const dataDir = mkdtempSync(join(tmpdir(), "yoqa-desktop-e2e-"));
const dbPath = join(dataDir, "yoqa.db");
const runnerEntry = join(import.meta.dir, "../../../services/runner/src/index.ts");

const runner = Bun.spawn(["bun", "run", runnerEntry], {
	env: {
		...process.env,
		YOQA_DB_PATH: dbPath,
		YOQA_RUNNER_HOST: "127.0.0.1",
		YOQA_RUNNER_PORT: String(RUNNER_PORT),
	},
	stdout: "inherit",
	stderr: "inherit",
});

function stop() {
	runner.kill();
	rmSync(dataDir, { recursive: true, force: true });
	process.exit(0);
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

async function waitForRunner() {
	for (let i = 0; i < 120; i++) {
		try {
			if ((await fetch(`${RUNNER_URL}/health`)).ok) return;
		} catch {}
		await Bun.sleep(250);
	}
	throw new Error("e2e: the runner did not answer /health");
}

async function post<T>(path: string, body: unknown): Promise<T> {
	const response = await fetch(`${RUNNER_URL}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!response.ok) throw new Error(`e2e: POST ${path} → ${response.status}`);
	return (await response.json()) as T;
}

await waitForRunner();
const app = await post<{ id: string }>("/apps", {
	name: SEED.appName,
	webUrl: "https://example.com",
});
await post(`/apps/${app.id}/cases`, { name: SEED.caseName });

// A Run needs a device to start, so the finished one is written straight to the catalog.
const now = Date.now();
const db = new Database(dbPath);
db.run(
	`insert into runs (id, app_id, device_id, platform, status, created_at, started_at, finished_at)
	 values (?, ?, ?, 'web', 'passed', ?, ?, ?)`,
	[SEED.runId, app.id, SEED.runDeviceId, now, now, now],
);
db.close();
console.log(`[e2e] runner seeded at ${RUNNER_URL}`);

await runner.exited;
