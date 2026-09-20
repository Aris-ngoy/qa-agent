import { describe, expect, test } from "bun:test";
import { isDriverKind, listDriverCatalog } from "./index";

describe("provider driver registry", () => {
	test("registers jev as a first-class kind", () => {
		expect(isDriverKind("jev")).toBe(true);
		expect(isDriverKind("not-a-driver")).toBe(false);
		expect(listDriverCatalog().some((driver) => driver.kind === "jev")).toBe(true);
	});
});
