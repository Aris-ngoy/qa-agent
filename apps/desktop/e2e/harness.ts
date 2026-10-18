/** Where the e2e runner and the webview listen, and the Run the runner is seeded with. */
export const RUNNER_PORT = 4791;
export const RUNNER_URL = `http://127.0.0.1:${RUNNER_PORT}`;
export const WEB_PORT = 5191;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

export const SEED = {
	appName: "E2E App",
	caseName: "Checkout happy path",
	runId: "run_e2e_title",
	runDeviceId: "chromium",
} as const;
