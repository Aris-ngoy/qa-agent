import { describe, expect, test } from "bun:test";
import { stopRunner } from "./stop-runner";

/** A stop whose quit is held open until the test lets it go, and which records exits. */
function stopping(capMs = 1_000) {
	const exits: number[] = [];
	let quits = 0;
	let finishQuit: () => void = () => undefined;
	let onExit: (code: number) => void = () => undefined;
	const exited = new Promise<number>((resolve) => {
		onExit = resolve;
	});
	const onSignal = stopRunner({
		quit: () => {
			quits += 1;
			return new Promise<void>((done) => {
				finishQuit = done;
			});
		},
		exit: (code) => {
			exits.push(code);
			onExit(code);
		},
		capMs,
		log: () => undefined,
	});
	return { onSignal, exits, exited, quits: () => quits, finishQuit: () => finishQuit() };
}

describe("stopping the runner on a signal", () => {
	test("quits the sessions before it exits", async () => {
		const stop = stopping();
		stop.onSignal("SIGTERM");
		expect(stop.quits()).toBe(1);
		await Bun.sleep(5);
		expect(stop.exits).toEqual([]);

		stop.finishQuit();
		expect(await stop.exited).toBe(0);
		expect(stop.exits).toEqual([0]);
	});

	test("exits after the cap when the quit hangs", async () => {
		const stop = stopping(20);
		const started = Date.now();
		stop.onSignal("SIGINT");
		expect(await stop.exited).toBe(1);
		expect(Date.now() - started).toBeGreaterThanOrEqual(15);
	});

	test("a second signal while quitting exits at once, without quitting again", async () => {
		const stop = stopping();
		stop.onSignal("SIGINT");
		stop.onSignal("SIGINT");
		expect(stop.exits).toEqual([130]);
		expect(stop.quits()).toBe(1);
	});

	test("a quit that fails still exits", async () => {
		const exits: number[] = [];
		const onSignal = stopRunner({
			quit: async () => {
				throw new Error("adb is gone");
			},
			exit: (code) => {
				exits.push(code);
			},
			capMs: 1_000,
			log: () => undefined,
		});
		onSignal("SIGTERM");
		await Bun.sleep(5);
		expect(exits).toEqual([0]);
	});
});
