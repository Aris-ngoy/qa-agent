import { expect, test } from "bun:test";
import { reportedLane, reportedLaneWarning } from "./legacy-lane";

test("a legacy Appium lane and its warning do not reach a report", () => {
	expect(reportedLane("appium")).toBeUndefined();
	expect(reportedLane("direct")).toBe("direct");
	expect(reportedLaneWarning("Direct lane is not available; fell back to Appium")).toBeUndefined();
	expect(reportedLaneWarning("yoqa-sim failed; using idb_companion")).toBe(
		"yoqa-sim failed; using idb_companion",
	);
	expect(reportedLaneWarning(null)).toBeUndefined();
});
