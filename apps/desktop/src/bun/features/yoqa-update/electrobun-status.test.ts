import { describe, expect, test } from "bun:test";
import { unrecoveredError } from "./electrobun-status";

describe("unrecoveredError", () => {
	test("is null when the attempt reported no error", () => {
		expect(
			unrecoveredError([
				{ status: "download-starting", message: "Starting update download..." },
				{ status: "download-complete", message: "Download complete" },
			]),
		).toBeNull();
	});

	test("reports the error that ended the attempt", () => {
		expect(
			unrecoveredError([
				{ status: "downloading-full-bundle", message: "Downloading full update bundle..." },
				{ status: "error", message: "Failed to download: https://example.test/x.tar.zst" },
			]),
		).toBe("Failed to download: https://example.test/x.tar.zst");
	});

	test("ignores a patch error Electrobun recovered from by downloading in full", () => {
		expect(
			unrecoveredError([
				{ status: "error", message: "Cyclical update detected, falling back to full download" },
				{ status: "downloading-full-bundle", message: "Downloading full update bundle..." },
				{ status: "download-complete", message: "Download complete" },
			]),
		).toBeNull();
	});

	test("never reports a recovered patch error for a later, unrelated failure", () => {
		expect(
			unrecoveredError([
				{ status: "error", message: "Cyclical update detected, falling back to full download" },
				{ status: "downloading-full-bundle", message: "Downloading full update bundle..." },
			]),
		).toBeNull();
	});
});
