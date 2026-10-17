import { describe, expect, test } from "bun:test";
import { applyTheme } from "@/features/settings/utils/apply-theme";

function fakeRoot() {
	return { dataset: {} as Record<string, string | undefined>, style: { colorScheme: "" } };
}

describe("applyTheme", () => {
	test("dark mode sets data-theme and color-scheme to dark", () => {
		const root = fakeRoot();
		expect(applyTheme(root, "dark", false)).toBe("dark");
		expect(root.dataset.theme).toBe("dark");
		expect(root.style.colorScheme).toBe("dark");
	});

	test("light mode wins over a dark OS", () => {
		const root = fakeRoot();
		applyTheme(root, "light", true);
		expect(root.dataset.theme).toBe("light");
		expect(root.style.colorScheme).toBe("light");
	});

	test("system follows the OS and updates when it changes", () => {
		const root = fakeRoot();
		applyTheme(root, "system", true);
		expect(root.dataset.theme).toBe("dark");
		applyTheme(root, "system", false);
		expect(root.dataset.theme).toBe("light");
		expect(root.style.colorScheme).toBe("light");
	});
});
