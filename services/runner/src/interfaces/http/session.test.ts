import { describe, expect, test } from "bun:test";
import { DirectLaneStartError } from "../../domains/devices/direct-lane";
import { DeadSessionError, DeviceUnreachableError } from "../../domains/devices/lane";
import { DeveloperNotTrustedError } from "../../domains/devices/yoqa-runner";
import { sessionErrorResponse } from "./session";

describe("sessionErrorResponse", () => {
	test("an Unreachable Session answers 503 and says how long the runner waits", () => {
		const response = sessionErrorResponse(
			new DeviceUnreachableError("YoqaRunner is briefly unreachable", 1200, 20_000),
		);
		expect(response?.status).toBe(503);
		expect(response?.body).toMatchObject({
			error: "Device unreachable",
			detail: "YoqaRunner is briefly unreachable",
			unreachableMs: 1200,
			graceMs: 20_000,
		});
	});

	test("a Dead Session answers 410", () => {
		const response = sessionErrorResponse(new DeadSessionError("Device session ended: gone"));
		expect(response?.status).toBe(410);
		expect(response?.body).toMatchObject({ error: "Device session ended" });
	});

	test("a Personal Team developer the iPhone does not trust answers 428 with what to tap", () => {
		const untrusted = new DeveloperNotTrustedError(
			"T4L8PFGHBJ",
			"Apple Development: a@b.c (63L33U439U)",
		);
		const response = sessionErrorResponse(
			new DirectLaneStartError(untrusted.message, [], { cause: untrusted }),
		);
		expect(response?.status).toBe(428);
		expect(response?.body).toEqual({
			error: "Developer not trusted on the iPhone",
			code: "DEVELOPER_NOT_TRUSTED",
			detail: untrusted.message,
			team: "T4L8PFGHBJ",
			certificate: "Apple Development: a@b.c (63L33U439U)",
		});
	});

	test("leaves other errors to the route", () => {
		expect(sessionErrorResponse(new Error("No element matching label: Login"))).toBeNull();
	});
});
