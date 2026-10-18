import { defineConfig, devices } from "@playwright/test";
import { RUNNER_URL, SEED, WEB_URL } from "./e2e/harness";

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
	use: {
		baseURL: WEB_URL,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: [
		{
			command: "bun e2e/start-runner.ts",
			// Ready once the seeded Run exists, not just when the runner listens.
			url: `${RUNNER_URL}/runs/${SEED.runId}`,
			reuseExistingServer: false,
			timeout: 60_000,
		},
		{
			command: "bunx vite --config vite.e2e.config.ts",
			url: WEB_URL,
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
		},
	],
});
