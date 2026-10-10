import { describe, expect, test } from "bun:test";
import { createFrameLoop } from "./frame-loop";

/** A capture source whose captures finish only when the test settles them, in any order. */
function gatedCapture() {
	const pending: Array<{ name: string; resolve: () => void; reject: (e: Error) => void }> = [];
	let started = 0;
	const capture = () => {
		const name = `frame-${started++}`;
		return new Promise<{ base64: string; mime: "image/png" }>((resolve, reject) => {
			pending.push({
				name,
				resolve: () => resolve({ base64: name, mime: "image/png" }),
				reject,
			});
		});
	};
	const take = (name: string) => {
		const index = pending.findIndex((p) => p.name === name);
		const [entry] = pending.splice(index, 1);
		if (!entry) throw new Error(`${name} is not in flight`);
		return entry;
	};
	return {
		capture,
		finish: async (name: string) => {
			take(name).resolve();
			await Bun.sleep(2);
		},
		fail: async (name: string) => {
			take(name).reject(new Error("screencap: transient"));
			await Bun.sleep(2);
		},
	};
}

describe("createFrameLoop", () => {
	test("an older capture finishing late never replaces a newer frame", async () => {
		const source = gatedCapture();
		const loop = createFrameLoop(source.capture, { idleMs: 60_000 });
		const first = loop.read();
		await Bun.sleep(1);
		loop.kick(); // frame-1 starts next to frame-0
		await source.finish("frame-1");
		await source.finish("frame-0");

		expect((await first).base64).toBe("frame-1");
		expect((await loop.read()).base64).toBe("frame-1");
		loop.stop();
	});

	test("a failed kicked capture leaves waiting reads to the loop", async () => {
		const source = gatedCapture();
		const loop = createFrameLoop(source.capture, { idleMs: 60_000 });
		const read = loop.read();
		await Bun.sleep(1);
		loop.kick();
		await source.fail("frame-1");
		await source.finish("frame-0");

		expect((await read).base64).toBe("frame-0");
		loop.stop();
	});
});
