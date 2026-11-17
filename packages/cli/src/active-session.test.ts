/**
 * The Device Session lookup on the accounting path. The case that matters is the slow one: the
 * seam makes this call after a command's output is already written, so it must have a deadline.
 */

import { describe, expect, test } from "bun:test";
import type { ActiveDeviceResponse } from "@yoqa/runner-client";
import { activeSessionId, resetSessionCache, sessionIdOnce } from "./active-session";

/** A runner that answers `/devices/active` with `active`, or hangs forever when told to. */
function fakeRunner(active: ActiveDeviceResponse | null, hang = false) {
	let asked = 0;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async () => {
			asked += 1;
			if (hang) await new Promise(() => {});
			return active ? Response.json(active) : new Response(null, { status: 404 });
		},
	});
	return {
		url: `http://127.0.0.1:${server.port}`,
		asked: () => asked,
		stop: () => server.stop(true),
	};
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

describe("resolving the session at most once per command", () => {
	test("asks the runner once however many times one command emits", async () => {
		// `yoqa script run --json` emits a line per action: twenty actions must not be twenty
		// round-trips for a session that cannot change while the command is running.
		const runner = fakeRunner({ deviceId: "sim-ABC", platform: "ios", connectedAt: 1_700 });
		resetSessionCache();
		try {
			const ids = await Promise.all([
				sessionIdOnce(runner.url),
				sessionIdOnce(runner.url),
				sessionIdOnce(runner.url),
			]);

			expect(ids).toEqual(["sim-ABC@1700", "sim-ABC@1700", "sim-ABC@1700"]);
			expect(runner.asked()).toBe(1);
		} finally {
			runner.stop();
		}
	});

	test("asks again for the next command, so a reconnect is never served from the last one", async () => {
		const runner = fakeRunner({ deviceId: "sim-ABC", platform: "ios", connectedAt: 1_700 });
		resetSessionCache();
		try {
			await sessionIdOnce(runner.url);
			resetSessionCache();
			await sessionIdOnce(runner.url);

			expect(runner.asked()).toBe(2);
		} finally {
			runner.stop();
		}
	});
});
