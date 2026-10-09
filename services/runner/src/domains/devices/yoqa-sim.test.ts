import { afterEach, describe, expect, test } from "bun:test";
import { type YoqaSimProcess, YoqaSimUnreachableError, spawnYoqaSim } from "./yoqa-sim";

const UDID = "B75001FB-B91D-4F94-80A7-3E371A641D27";
const FRAME = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

type Mode = "ok" | "no-stream" | "exit" | "silent";

/**
 * Stands in for the `yoqa-sim` process at its wire protocol: it prints `api_ready` for a
 * real loopback server that serves `/screenshot`, then `stream_ready`, and stops serving
 * when killed. `no-stream` prints no `stream_ready`; `exit` dies before `api_ready`;
 * `silent` never prints it.
 */
function fakeYoqaSim(mode: Mode = "ok") {
	const launched: string[][] = [];
	const requests: Array<{ method: string; path: string; body: unknown }> = [];
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
		} else if (mode === "ok" || mode === "no-stream") {
			server = Bun.serve({
				port: 0,
				hostname: "127.0.0.1",
				fetch: async (request) => {
					const url = new URL(request.url);
					const body = request.method === "POST" ? await request.json() : null;
					requests.push({ method: request.method, path: `${url.pathname}${url.search}`, body });
					if (url.pathname === "/screenshot") {
						return new Response(FRAME, {
							headers: { "content-type": "image/png", "x-frame-hash": "9f2c00aa" },
						});
					}
					if (url.pathname === "/key" && (body as { key?: string }).key !== "home") {
						return Response.json({ error: "unsupported key volume-up" }, { status: 400 });
					}
					if (["/tap", "/swipe", "/key"].includes(url.pathname)) return Response.json({ ok: true });
					return new Response("not found", { status: 404 });
				},
			});
			servers.push(server);
			out.enqueue(encoder.encode("starting\n"));
			out.enqueue(encoder.encode(`api_ready http://127.0.0.1:${server.port}\n`));
			if (mode === "ok") {
				out.enqueue(encoder.encode(`stream_ready http://127.0.0.1:${server.port}/stream.mjpeg\n`));
			}
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
		requests,
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
		expect(await sim.frame()).toEqual({ bytes: FRAME, mime: "image/png", hash: "9f2c00aa" });
		expect(fake.requests).toEqual([
			{ method: "GET", path: "/screenshot?scale=1&format=png", body: null },
		]);
		expect(fake.launched).toEqual([["/opt/yoqa-sim", "ios", "--id", UDID]]);
		await sim.stop();
	});

	test("reads the live stream URL from its stream_ready line", async () => {
		fake = fakeYoqaSim();
		const sim = await spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn });
		expect(sim.stream).toBe(`${sim.url}/stream.mjpeg`);
		await sim.stop();
	});

	test("has no stream when stream_ready doesn't follow api_ready", async () => {
		fake = fakeYoqaSim("no-stream");
		const started = performance.now();
		const sim = await spawnYoqaSim(UDID, {
			command: ["/opt/yoqa-sim"],
			spawn: fake.spawn,
			streamReadyTimeoutMs: 50,
		});
		expect(sim.stream).toBeNull();
		expect(performance.now() - started).toBeLessThan(1000);
		expect(await sim.frame()).toMatchObject({ hash: "9f2c00aa" });
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

	test("sends taps, swipes and keys in 0.0–1.0, and waits for each to finish", async () => {
		fake = fakeYoqaSim();
		const sim = await spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn });
		await sim.tap(0.25, 0.5);
		await sim.tap(0.25, 0.5, 600);
		await sim.swipe({ x: 0.5, y: 0.9 }, { x: 0.5, y: 0.1 }, 300);
		await sim.key("home");
		expect(fake.requests).toEqual([
			{ method: "POST", path: "/tap", body: { x: 0.25, y: 0.5 } },
			{ method: "POST", path: "/tap", body: { x: 0.25, y: 0.5, holdMs: 600 } },
			{
				method: "POST",
				path: "/swipe",
				body: { fromX: 0.5, fromY: 0.9, toX: 0.5, toY: 0.1, durationMs: 300 },
			},
			{ method: "POST", path: "/key", body: { key: "home" } },
		]);
		await sim.stop();
	});

	test("a refused command rejects with yoqa-sim's reason", async () => {
		fake = fakeYoqaSim();
		const sim = await spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn });
		await expect(sim.key("volume-up" as "home")).rejects.toThrow(/key: 400 .*unsupported key/);
		await sim.stop();
	});

	test("a yoqa-sim that can't be reached is reported as unreachable, so the call is safe to redo", async () => {
		fake = fakeYoqaSim();
		const sim = await spawnYoqaSim(UDID, { command: ["/opt/yoqa-sim"], spawn: fake.spawn });
		fake.close();
		const error = await sim.tap(0.5, 0.5).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(YoqaSimUnreachableError);
		await sim.stop();
	});
});
