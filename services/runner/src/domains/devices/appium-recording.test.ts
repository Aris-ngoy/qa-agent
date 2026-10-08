import { describe, expect, test } from "bun:test";
import { screenRecordingOptions } from "./appium-lane";

describe("screenRecordingOptions", () => {
	test("iOS asks for H.264, because the default MJPEG cannot be played in the app", () => {
		expect(screenRecordingOptions(false)).toMatchObject({
			videoType: "libx264",
			pixelFormat: "yuv420p",
			timeLimit: 1800,
		});
	});

	test("iOS rounds the frame to even sizes, which H.264 in yuv420p requires", () => {
		// An odd-sized phone screen (e.g. 471x1023) otherwise yields an empty file.
		expect(screenRecordingOptions(false).videoFilters).toContain(
			"scale=trunc(iw/2)*2:trunc(ih/2)*2",
		);
	});

	test("iOS converts the full-range MJPEG source to standard yuv420p", () => {
		// Without this ffmpeg keeps yuvj420p, which QuickTime and some players refuse.
		expect(screenRecordingOptions(false).videoFilters).toContain(
			"in_range=pc:out_range=tv,format=yuv420p",
		);
	});

	test("Android keeps its native H.264 and only lifts the 3-minute limit", () => {
		expect(screenRecordingOptions(true)).toEqual({ timeLimit: 1800 });
	});
});
