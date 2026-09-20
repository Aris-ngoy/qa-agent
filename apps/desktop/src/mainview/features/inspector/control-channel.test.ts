import { describe, expect, test } from "bun:test";
import { controlErrorText, parseControlPayload } from "./control-channel";

describe("parseControlPayload", () => {
	test("parses end acks", () => {
		expect(
			parseControlPayload(JSON.stringify({ ok: true, type: "ack", phase: "end", seq: 7 })),
		).toEqual({ kind: "ack", phase: "end", seq: 7 });
	});

	test("parses coded pointer failures", () => {
		expect(
			parseControlPayload(
				JSON.stringify({
					ok: false,
					error: "Pointer event failed",
					detail: "boom",
					code: "POINTER_FAILED",
				}),
			),
		).toEqual({
			kind: "error",
			message: "Pointer event failed",
			detail: "boom",
			code: "POINTER_FAILED",
		});
	});

	test("ignores ready and garbage payloads", () => {
		expect(parseControlPayload(JSON.stringify({ ok: true, type: "ready" }))).toBeNull();
		expect(parseControlPayload("not json")).toBeNull();
		expect(parseControlPayload(JSON.stringify({ ok: true, type: "ack", phase: "end" }))).toBeNull();
	});

	test("controlErrorText formats detail and code", () => {
		expect(
			controlErrorText({
				kind: "error",
				message: "Pointer event failed",
				detail: "boom",
				code: "POINTER_FAILED",
			}),
		).toBe("Pointer event failed: boom [POINTER_FAILED]");
		expect(controlErrorText({ kind: "error", message: "Nope" })).toBe("Nope");
	});
});
