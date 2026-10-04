import { describe, expect, test } from "bun:test";
import { tapHitsElement } from "./accuracy";

const login = {
	type: "Button",
	label: "Login",
	id: "login",
	x: 400,
	y: 700,
	width: 200,
	height: 80,
};
const title = { type: "Text", label: "Welcome", x: 100, y: 100, width: 800, height: 60 };

describe("tapHitsElement", () => {
	test("a point inside the intended label is a hit", () => {
		expect(tapHitsElement([title, login], 500, 740, { label: "Login" })).toBe(true);
	});

	test("a point outside the intended element is a miss", () => {
		expect(tapHitsElement([title, login], 500, 200, { label: "Login" })).toBe(false);
	});

	test("with no intended target, any covering element counts", () => {
		expect(tapHitsElement([title, login], 500, 120)).toBe(true);
		expect(tapHitsElement([title, login], 10, 10)).toBe(false);
	});
});
