import { describe, expect, test } from "bun:test";
import {
	TREE_STALE_MS,
	controlSocketWanted,
	isScreenChangedMessage,
	isTreeStale,
	treeReadOnScreenChange,
} from "./tree-freshness";

const WEB = { deviceId: "web-chrome", platform: "web" as const, connectedAt: 1 };
const PHONE = { deviceId: "dev-1", platform: "ios" as const, connectedAt: 1 };

/** A tree read that started at 1000 and came back at 1200. */
const READ = { startedAt: 1000, doneAt: 1200 };

describe("isTreeStale", () => {
	test("a tree never read is stale", () => {
		expect(isTreeStale({ startedAt: 0, doneAt: 0 }, { session: WEB, changedAt: 0 }, 5)).toBe(true);
		expect(isTreeStale({ startedAt: 0, doneAt: 0 }, { session: PHONE, changedAt: 0 }, 5)).toBe(
			true,
		);
	});

	test("a web tree is stale once the page changed after its read began", () => {
		expect(isTreeStale(READ, { session: WEB, changedAt: 1500 }, 1600)).toBe(true);
	});

	test("a change during the read makes it stale too: the tree may show the page before it", () => {
		expect(isTreeStale(READ, { session: WEB, changedAt: 1100 }, 1300)).toBe(true);
	});

	test("a web tree read after the last change is fresh, however old", () => {
		expect(isTreeStale(READ, { session: WEB, changedAt: 900 }, 1300)).toBe(false);
	});

	test("a phone's tree goes stale with time only, as before", () => {
		expect(isTreeStale(READ, { session: PHONE, changedAt: 1500 }, 1600)).toBe(false);
		expect(isTreeStale(READ, { session: PHONE, changedAt: 0 }, 1200 + TREE_STALE_MS)).toBe(false);
		expect(isTreeStale(READ, { session: PHONE, changedAt: 0 }, 1201 + TREE_STALE_MS)).toBe(true);
	});

	test("a web tree older than that is stale too, should a signal go missing", () => {
		expect(isTreeStale(READ, { session: WEB, changedAt: 0 }, 1201 + TREE_STALE_MS)).toBe(true);
	});
});

describe("treeReadOnScreenChange", () => {
	test("a web page that changed is read again at once", () => {
		expect(treeReadOnScreenChange(WEB, { reading: false, liveControl: false })).toBe("read");
	});

	test("changes during a read are one more read once it ends, not one each", () => {
		expect(treeReadOnScreenChange(WEB, { reading: true, liveControl: false })).toBe("after-read");
	});

	test("under live control nothing is read until Select mode, which reads anyway", () => {
		expect(treeReadOnScreenChange(WEB, { reading: false, liveControl: true })).toBe("none");
	});

	test("a phone is not read on a change: its tree read cuts the Stream", () => {
		expect(treeReadOnScreenChange(PHONE, { reading: false, liveControl: false })).toBe("none");
	});
});

describe("controlSocketWanted", () => {
	test("a web session keeps the control socket open for the screen-changed signal", () => {
		expect(controlSocketWanted(WEB, false)).toBe(true);
		expect(controlSocketWanted(WEB, true)).toBe(true);
	});

	test("a phone opens it only under live control, as before", () => {
		expect(controlSocketWanted(PHONE, false)).toBe(false);
		expect(controlSocketWanted(PHONE, true)).toBe(true);
	});
});

describe("isScreenChangedMessage", () => {
	test("reads the runner's screen-changed message", () => {
		expect(isScreenChangedMessage(JSON.stringify({ ok: true, type: "screen-changed" }))).toBe(true);
	});

	test("ignores acks, errors, and anything that is not JSON", () => {
		expect(isScreenChangedMessage(JSON.stringify({ ok: true, type: "ack", seq: 1 }))).toBe(false);
		expect(isScreenChangedMessage(JSON.stringify({ ok: false, error: "No session" }))).toBe(false);
		expect(isScreenChangedMessage("not json")).toBe(false);
		expect(isScreenChangedMessage(new ArrayBuffer(2))).toBe(false);
	});
});
