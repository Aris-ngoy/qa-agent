import { describe, expect, test } from "bun:test";
import { initialScriptState, pushLog } from "@/features/inspector/data/state/script";
import { observable } from "@legendapp/state";

describe("pushLog", () => {
	test("sets a whole new log, so the panel that reads it whole shows every line", () => {
		const script$ = observable(initialScriptState());
		const first = { id: "1", text: "Reload page…", tone: "info" as const };
		const second = { id: "2", text: "Done · 1/1 steps", tone: "ok" as const };
		pushLog(script$, first);
		const before = script$.log.peek();
		pushLog(script$, second);
		expect(script$.log.peek()).not.toBe(before);
		expect(script$.log.peek()).toEqual([first, second]);
		expect(before).toEqual([first]);
	});
});
