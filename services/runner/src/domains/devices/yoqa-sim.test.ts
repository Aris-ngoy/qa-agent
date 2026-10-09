import { afterEach, describe, expect, test } from "bun:test";
import { type YoqaSimProcess, spawnYoqaSim } from "./yoqa-sim";

const UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";
const FRAME = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

type Mode = "ok" | "exit" | "silent";

/**
 * Stands in for the `yoqa-sim` process at its wire protocol: it prints `api_ready` for a
 * real loopback server that serves `/screenshot`, and stops serving when killed.
 * `exit` dies before `api_ready`; `silent` never prints it.
 */
function fakeYoqaSim(mode: Mode = "ok") {
	const launched: string[][] = [];
	const servers: Array<ReturnType<typeof Bun.serve>> = [];
	let kills = 0;
	const spawn = (command: string[]): YoqaSimProcess => {
		launched.push(command);
		const encoder = new TextEncoder();
		let out!: ReadableStreamDefaultController<Uint8Array>;
		let err!: ReadableStreamDefaultController<Uint8Array>;
		const stdout = new ReadableStream<Uint8Array>({
			start: (controller) => {
				out = controller;
			},
		});
		const stderr = new ReadableStream<Uint8Array>({
			start: (controller) => {
				err = controller;
			},
		});
		let exit: (code: number) => void = () => undefined;
		const exited = new Promise<number>((resolve) => {
			exit = resolve;
		});
		let server: ReturnType<typeof Bun.serve> | null = null;
		let dead = false;
		const die = (code: number) => {
			dead = true;
			server?.stop(true);
			out.close();
			err.close();
			exit(code);
		};
		if (mode === "exit") {
			err.enqueue(encoder.encode("SimulatorKit not found under /Applications/Xcode.app\n"));
			die(3);
		} else if (mode === "ok") {
			server = Bun.serve({
				port: 0,
				hostname: "127.0.0.1",
				fetch: (request) =>
					new URL(request.url).pathname === "/screenshot"
						? new Response(FRAME, { headers: { "content-type": "image/png" } })
						: new Response("not found", { status: 404 }),
			});
			servers.push(server);
			out.enqueue(encoder.encode("starting\n"));
			out.enqueue(encoder.encode(`api_ready http://127.0.0.1:${server.port}\n`));
		}
		return {
			stdout,
			stderr,
			exited,
			kill: () => {
				kills += 1;
				if (!dead) die(143);
			},
		};
	};
	return {
		spawn,
		launched,
		kills: () => kills,
		close: () => {
			for (const server of servers) server.stop(true);
		},
	};
}

let fake: ReturnType<typeof fakeYoqaSim> | null = null;
afterEach(() => {
	fake?.close();
	fake = null;
});

async function alive(url: string): Promise<boolean> {
	return fetch(`${url}/screenshot`, { signal: AbortSignal.timeout(500) }).then(
		() => true,
		() => false,
	);
}

describe("spawnYoqaSim", () => {
	test("starts yoqa-sim for the simulator, reads its api_ready URL and serves screenshots", async () => {
		fake = fakeYoqaSim();
		const sim = await spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn });

		expect(sim.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(await sim.screenshot()).toEqual(FRAME);
		expect(fake.launched).toEqual([["/opt/yoqa-sim", "ios", "--id", UDID]]);
		await sim.stop();
	});

	test("passes the device set when there is one", async () => {
		fake = fakeYoqaSim();
		const sim = await spawnYoqaSim(UDID, {
			command: ["/opt/yoqa-sim"],
			deviceSet: "/tmp/radon set",
			spawn: fake.spawn,
		});
		expect(fake.launched).toEqual([
			["/opt/yoqa-sim", "ios", "--id", UDID, "--device-set", "/tmp/radon set"],
		]);
		await sim.stop();
	});

	test("stop kills it, and can be called twice", async () => {
		fake = fakeYoqaSim();
		const sim = await spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn });
		await sim.stop();
		await sim.stop();
		expect(fake.kills()).toBe(1);
		expect(await alive(sim.url)).toBe(false);
	});

	test("rejects with its error when it exits before api_ready", async () => {
		fake = fakeYoqaSim("exit");
		await expect(
			spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn }),
		).rejects.toThrow(/exited \(3\) before api_ready: SimulatorKit not found/);
	});

	test("rejects and kills it when api_ready never comes", async () => {
		fake = fakeYoqaSim("silent");
		await expect(
			spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn, readyTimeoutMs: 200 }),
		).rejects.toThrow(/no api_ready within 200 ms/);
		expect(fake.kills()).toBe(1);
	});
});
