import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { type YoqaAxProcess, startYoqaAx } from "./yoqa-ax";

const UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";
const BIN = "/opt/yoqa/yoqa-ax";

type Mode = "ok" | "silent" | "exit";

function frame(body: unknown): Buffer {
	const json = Buffer.from(JSON.stringify(body));
	const header = Buffer.alloc(4);
	header.writeUInt32BE(json.length);
	return Buffer.concat([header, json]);
}

/**
 * Stands in for `simctl spawn … yoqa-ax` at its wire protocol: it connects back to the
 * socket named after `--connect` and answers `ping` with length-prefixed JSON.
 * `silent` never connects; `exit` dies before connecting.
 */
function fakeYoqaAx(mode: Mode = "ok") {
	const launched: string[][] = [];
	let kills = 0;
	let closedByRunner = false;
	const spawn = (command: string[]): YoqaAxProcess => {
		launched.push(command);
		let exit: (code: number) => void = () => undefined;
		const exited = new Promise<number>((resolve) => {
			exit = resolve;
		});
		let socket: ReturnType<typeof connect> | null = null;
		if (mode === "exit") {
			setTimeout(() => exit(1), 5);
		} else if (mode === "ok") {
			const path = command[command.indexOf("--connect") + 1] ?? "";
			socket = connect(path);
			let buffered = Buffer.alloc(0);
			socket.on("data", (chunk) => {
				buffered = Buffer.concat([buffered, chunk]);
				while (buffered.length >= 4 && buffered.length >= 4 + buffered.readUInt32BE(0)) {
					const length = buffered.readUInt32BE(0);
					const request = JSON.parse(buffered.subarray(4, 4 + length).toString()) as {
						id: number;
						method: string;
					};
					buffered = buffered.subarray(4 + length);
					socket?.write(
						frame(
							request.method === "ping"
								? { id: request.id, result: "ok" }
								: { id: request.id, error: `unknown method ${request.method}` },
						),
					);
				}
			});
			socket.on("end", () => {
				closedByRunner = true;
				exit(0);
			});
			socket.on("error", () => undefined);
		}
		return {
			exited,
			kill: () => {
				kills += 1;
				socket?.destroy();
				exit(143);
			},
		};
	};
	return {
		spawn,
		launched,
		kills: () => kills,
		closedByRunner: () => closedByRunner,
		socketPath: () => {
			const command = launched[0] ?? [];
			return command[command.indexOf("--connect") + 1] ?? "";
		},
	};
}

describe("startYoqaAx", () => {
	test("binds a socket, spawns the helper inside the simulator, and ping answers ok", async () => {
		const fake = fakeYoqaAx();
		const ax = await startYoqaAx(UDID, { bin: BIN, spawn: fake.spawn });
		try {
			expect(fake.launched).toEqual([
				["xcrun", "simctl", "spawn", UDID, BIN, "--connect", fake.socketPath()],
			]);
			expect(fake.socketPath()).toMatch(/^\/tmp\/yoqa-ax-b75001fb-[0-9a-f]+\.sock$/);
			expect(await ax.ping()).toBe("ok");
			expect(await ax.ping()).toBe("ok");
		} finally {
			await ax.stop();
		}
	});

	test("a helper that never connects is given up after the connect timeout, and cleaned up", async () => {
		const fake = fakeYoqaAx("silent");
		const started = performance.now();
		await expect(
			startYoqaAx(UDID, { bin: BIN, spawn: fake.spawn, connectTimeoutMs: 80 }),
		).rejects.toThrow("yoqa-ax did not connect within 80 ms");
		expect(performance.now() - started).toBeGreaterThanOrEqual(75);
		expect(fake.kills()).toBe(1);
		expect(existsSync(fake.socketPath())).toBe(false);
	});

	test("a helper that exits before connecting fails at once, with its exit code", async () => {
		const fake = fakeYoqaAx("exit");
		const started = performance.now();
		await expect(
			startYoqaAx(UDID, { bin: BIN, spawn: fake.spawn, connectTimeoutMs: 5_000 }),
		).rejects.toThrow("yoqa-ax exited (1) before connecting");
		expect(performance.now() - started).toBeLessThan(1_000);
		expect(existsSync(fake.socketPath())).toBe(false);
	});

	test("stop closes the connection, ends the helper and removes the socket; twice is safe", async () => {
		const fake = fakeYoqaAx();
		const ax = await startYoqaAx(UDID, { bin: BIN, spawn: fake.spawn });
		expect(existsSync(fake.socketPath())).toBe(true);
		await ax.stop();
		await ax.stop();
		expect(fake.closedByRunner()).toBe(true);
		expect(existsSync(fake.socketPath())).toBe(false);
		await expect(ax.ping()).rejects.toThrow("yoqa-ax is stopped");
	});
});
