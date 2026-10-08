import { describe, expect, test } from "bun:test";
import { screenRecordingOptions } from "./appium-lane";

describe("screenRecordingOptions", () => {
	test("iOS asks for H.264, because the default MJPEG cannot be played in the app", () => {
		expect(screenRecordingOptions(false)).toEqual({
			videoType: "libx264",
			pixelFormat: "yuv420p",
			timeLimit: 1800,
		});
	});

	test("Android keeps its native H.264 and only lifts the 3-minute limit", () => {
		expect(screenRecordingOptions(true)).toEqual({ timeLimit: 1800 });
	});
});
