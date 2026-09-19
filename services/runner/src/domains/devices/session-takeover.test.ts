import { describe, expect, test } from "bun:test";
import { AgentDeviceError } from "../agent-device/cli";
import { withDeviceInUseTakeover } from "./session";

describe("withDeviceInUseTakeover", () => {
	test("closes the leftover session and retries once", async () => {
		const closed: string[] = [];
		let attempts = 0;
		const result = await withDeviceInUseTakeover(
			async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new AgentDeviceError(
						'Device is already in use by session "cwd:fcfcd77c2e6b136e:ios".',
						"DEVICE_IN_USE",
						undefined,
						JSON.stringify({ session: "cwd:fcfcd77c2e6b136e:ios" }),
					);
				}
				return "opened";
			},
			async (address) => {
				closed.push(address);
			},
		);
		expect(result).toBe("opened");
		expect(attempts).toBe(2);
		expect(closed).toEqual(["cwd:fcfcd77c2e6b136e:ios"]);
	});

	test("does not close a workspace-owned claim", async () => {
		const closed: string[] = [];
		const error = new AgentDeviceError(
			'Device is owned by session "cwd:abc:ios" in workspace /tmp/other.',
			"DEVICE_IN_USE",
		);
		await expect(
			withDeviceInUseTakeover(
				async () => {
					throw error;
				},
				async (address) => {
					closed.push(address);
				},
			),
		).rejects.toBe(error);
		expect(closed).toEqual([]);
	});

	test("rethrows unrelated errors without closing", async () => {
		const closed: string[] = [];
		const error = new Error("open failed");
		await expect(
			withDeviceInUseTakeover(
				async () => {
					throw error;
				},
				async (address) => {
					closed.push(address);
				},
			),
		).rejects.toBe(error);
		expect(closed).toEqual([]);
	});

	test("surfaces the second open error after a close", async () => {
		const closed: string[] = [];
		let attempts = 0;
		const second = new AgentDeviceError("still busy", "DEVICE_IN_USE");
		await expect(
			withDeviceInUseTakeover(
				async () => {
					attempts += 1;
					if (attempts === 1) {
						throw new AgentDeviceError(
							'Device is already in use by session "cwd:dead:ios".',
							"DEVICE_IN_USE",
						);
					}
					throw second;
				},
				async (address) => {
					closed.push(address);
				},
			),
		).rejects.toBe(second);
		expect(attempts).toBe(2);
		expect(closed).toEqual(["cwd:dead:ios"]);
	});
});
