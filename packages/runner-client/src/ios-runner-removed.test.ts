import { describe, expect, test } from "bun:test";
import { RunnerClient } from "./index";

/**
 * `/devices/ios-runner/*` are explicit 410s since the Argent cutover (Argent
 * manages its own runner). These lock the near-miss: `requestJson` must throw
 * the server's `{error, detail}` body on `!response.ok` BEFORE any success
 * schema is parsed — otherwise the dual-shape status body (`installed:false`
 * alongside `{error, detail}`) would parse cleanly into a `IosRunnerStatusResponse`
 * and the 410 would be silently swallowed as "runner not installed".
 */
function clientReturning(status: number, body: unknown): RunnerClient {
	return new RunnerClient({
		baseUrl: "http://runner.test",
		fetchImpl: (async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { "Content-Type": "application/json" },
			})) as unknown as typeof fetch,
	});
}

const REMOVED_STATUS_BODY = {
	error: "iOS runner install is gone — Argent manages its own runner",
	detail:
		"Argent manages its own runner — nothing to install. " +
		"Install Argent globally with: npm install -g @swmansion/argent",
	// Dual shape: the status-schema fields, so a body-reader can't silently win.
	installed: false,
	bundleId: "n/a",
	displayName: "iOS runner removed (Argent manages its own runner)",
};

describe("ios-runner endpoints after the Argent cutover", () => {
	test("getIosRunnerStatus rejects with the 410 error body, never a parsed status", async () => {
		const client = clientReturning(410, REMOVED_STATUS_BODY);

		await expect(client.getIosRunnerStatus("sim-1", "physical")).rejects.toThrow(
			/iOS runner install is gone — Argent manages its own runner/,
		);
		await expect(client.getIosRunnerStatus("sim-1", "physical")).rejects.toThrow(
			/npm install -g @swmansion\/argent/,
		);
		// Not the generic fallback, and not a schema error.
		await expect(client.getIosRunnerStatus("sim-1", "physical")).rejects.not.toThrow(
			/Runner status failed: HTTP 410/,
		);
	});

	test("installIosRunner rejects with the pure {error, detail} 410 body", async () => {
		const client = clientReturning(410, {
			error: "iOS runner install is gone — Argent manages its own runner",
			detail: "Argent manages its own runner — nothing to install.",
		});

		await expect(client.installIosRunner({ deviceId: "sim-1", kind: "physical" })).rejects.toThrow(
			/Argent manages its own runner/,
		);
	});
});
