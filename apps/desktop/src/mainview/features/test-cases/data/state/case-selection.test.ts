import { describe, expect, test } from "bun:test";
import { selectAppId } from "@/features/apps/data/state/selected-app";
import {
	clearSelectedCases,
	selectedCaseIds$,
	setSelectedCases,
	toggleCase,
} from "@/features/test-cases/data/state/case-selection";

describe("case selection", () => {
	test("toggle adds a case, then removes it", () => {
		clearSelectedCases();
		toggleCase("c1");
		toggleCase("c2");
		expect(selectedCaseIds$.get()).toEqual(["c1", "c2"]);
		toggleCase("c1");
		expect(selectedCaseIds$.get()).toEqual(["c2"]);
	});

	test("setting the selection drops duplicates", () => {
		setSelectedCases(["c1", "c1", "c2"]);
		expect(selectedCaseIds$.get()).toEqual(["c1", "c2"]);
	});

	test("switching apps clears the selection", () => {
		selectAppId("app-a");
		setSelectedCases(["c1"]);
		selectAppId("app-b");
		expect(selectedCaseIds$.get()).toEqual([]);
	});
});
