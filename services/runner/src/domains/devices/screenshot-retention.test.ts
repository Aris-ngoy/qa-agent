import { describe, expect, test } from "bun:test";
import { resolveScreenshotRetentionMs, selectScreenshotsForPruning } from "./screenshot-retention";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24);

describe("selectScreenshotsForPruning", () => {
	test("deletes old step screenshots and keeps recent ones", () => {
		const entries = [
			{ name: "shot_1758000000000_aaaa-bbbb.png", mtimeMs: NOW - 10 * DAY },
			{ name: "shot_1758100000000_cccc-dddd.png", mtimeMs: NOW - 1 * DAY },
			{ name: "shot_1758110000000_eeee-ffff.png", mtimeMs: NOW - 10 * 60 * 1000 },
		];
		expect(selectScreenshotsForPruning(entries, { maxAgeMs: 7 * DAY, now: NOW })).toEqual([
			"shot_1758000000000_aaaa-bbbb.png",
		]);
	});

	test("keeps files that are not step screenshots", () => {
		const entries = [
			{ name: "report.html", mtimeMs: NOW - 99 * DAY },
			{ name: "notes.txt", mtimeMs: NOW - 99 * DAY },
		];
		expect(selectScreenshotsForPruning(entries, { maxAgeMs: DAY, now: NOW })).toEqual([]);
	});

	test("retention at or below zero disables pruning", () => {
		const entries = [{ name: "shot_1_aaaa.png", mtimeMs: NOW - 99 * DAY }];
		expect(selectScreenshotsForPruning(entries, { maxAgeMs: 0, now: NOW })).toEqual([]);
		expect(selectScreenshotsForPruning(entries, { maxAgeMs: -1, now: NOW })).toEqual([]);
	});
});

describe("resolveScreenshotRetentionMs", () => {
	test("defaults to seven days and honors the env override", () => {
		expect(resolveScreenshotRetentionMs({})).toBe(7 * DAY);
		expect(resolveScreenshotRetentionMs({ YOQA_SCREENSHOT_RETENTION_DAYS: "2" })).toBe(2 * DAY);
		expect(resolveScreenshotRetentionMs({ YOQA_SCREENSHOT_RETENTION_DAYS: "0" })).toBe(0);
		expect(resolveScreenshotRetentionMs({ YOQA_SCREENSHOT_RETENTION_DAYS: "nonsense" })).toBe(
			7 * DAY,
		);
	});
});
