/**
 * The Device Session lookup on the accounting path. The case that matters is the slow one: the
 * seam makes this call after a command's output is already written, so it must have a deadline.
 */

import { describe, expect, test } from "bun:test";
import type { ActiveDeviceResponse } from "@yoqa/runner-client";
import { activeSessionId } from "./active-session";

/** A runner that answers `/devices/active` with `active`, or hangs forever when told to. */
function fakeRunner(active: ActiveDeviceResponse | null, hang = false) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async () => {
			if (hang) await new Promise(() => {});
			return active ? Response.json(active) : new Response(null, { status: 404 });
		},
	});
	return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
}

describe("the Device Session an emission is accounted to", () => {
	test("names the device and when it connected", async () => {
		const runner = fakeRunner({
			deviceId: "sim-ABC",
			platform: "ios",
			connectedAt: 1_700_000_000_000,
		});
		try {
			expect(await activeSessionId(runner.url)).toBe("sim-ABC@1700000000000");
		} finally {
			runner.stop();
		}
	});

	test("is nothing at all when no device is connected", async () => {
		const runner = fakeRunner(null);
		try {
			expect(await activeSessionId(runner.url)).toBeNull();
		} finally {
			runner.stop();
		}
	});

	test("gives up on a runner that accepts the connection and then never answers", async () => {
		const runner = fakeRunner(null, true);
		try {
			await expect(activeSessionId(runner.url, { timeoutMs: 50 })).rejects.toThrow();
		} finally {
			runner.stop();
		}
	});
});
