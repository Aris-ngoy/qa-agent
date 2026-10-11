import { describe, expect, test } from "bun:test";
import { DeadSessionError, DeviceUnreachableError } from "../../domains/devices/lane";
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

	test("leaves other errors to the route", () => {
		expect(sessionErrorResponse(new Error("No element matching label: Login"))).toBeNull();
	});
});
