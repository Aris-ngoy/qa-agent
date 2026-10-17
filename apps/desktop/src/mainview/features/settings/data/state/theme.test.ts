import { describe, expect, test } from "bun:test";
import { effectiveTheme$, osPrefersDark$, themeMode$ } from "@/features/settings/data/state/theme";

describe("theme", () => {
	test("System follows the OS setting", () => {
		themeMode$.set("system");
		osPrefersDark$.set(true);
		expect(effectiveTheme$.get()).toBe("dark");
		osPrefersDark$.set(false);
		expect(effectiveTheme$.get()).toBe("light");
	});

	test("an explicit mode wins over the OS", () => {
		osPrefersDark$.set(true);
		themeMode$.set("light");
		expect(effectiveTheme$.get()).toBe("light");
	});
});
