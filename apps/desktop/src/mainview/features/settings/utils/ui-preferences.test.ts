import { describe, expect, test } from "bun:test";
import {
	readSidebarCollapsed,
	readThemeMode,
	resolveTheme,
	writeSidebarCollapsed,
	writeThemeMode,
} from "@/features/settings/utils/ui-preferences";

function memoryStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => {
			items.set(key, value);
		},
	};
}

const throwingStorage = {
	getItem: () => {
		throw new Error("denied");
	},
	setItem: () => {
		throw new Error("denied");
	},
};

describe("theme mode", () => {
	test("defaults to system", () => {
		expect(readThemeMode(memoryStorage())).toBe("system");
	});

	test("round-trips each mode", () => {
		for (const mode of ["light", "dark", "system"] as const) {
			const storage = memoryStorage();
			writeThemeMode(mode, storage);
			expect(readThemeMode(storage)).toBe(mode);
		}
	});

	test("falls back to system for an invalid stored value", () => {
		expect(readThemeMode(memoryStorage({ "yoqa.themeMode": "purple" }))).toBe("system");
	});

	test("tolerates missing and throwing storage", () => {
		expect(readThemeMode(null)).toBe("system");
		expect(readThemeMode(throwingStorage)).toBe("system");
		expect(() => writeThemeMode("dark", null)).not.toThrow();
		expect(() => writeThemeMode("dark", throwingStorage)).not.toThrow();
	});
});

describe("sidebar collapsed", () => {
	test("defaults to expanded", () => {
		expect(readSidebarCollapsed(memoryStorage())).toBe(false);
	});

	test("round-trips both states", () => {
		const storage = memoryStorage();
		writeSidebarCollapsed(true, storage);
		expect(readSidebarCollapsed(storage)).toBe(true);
		writeSidebarCollapsed(false, storage);
		expect(readSidebarCollapsed(storage)).toBe(false);
	});

	test("falls back to expanded for an invalid stored value", () => {
		expect(readSidebarCollapsed(memoryStorage({ "yoqa.sidebarCollapsed": "maybe" }))).toBe(false);
	});

	test("tolerates missing and throwing storage", () => {
		expect(readSidebarCollapsed(null)).toBe(false);
		expect(readSidebarCollapsed(throwingStorage)).toBe(false);
		expect(() => writeSidebarCollapsed(true, null)).not.toThrow();
		expect(() => writeSidebarCollapsed(true, throwingStorage)).not.toThrow();
	});
});

describe("resolveTheme", () => {
	test("explicit modes ignore the OS preference", () => {
		expect(resolveTheme("light", true)).toBe("light");
		expect(resolveTheme("dark", false)).toBe("dark");
	});

	test("system follows the OS preference", () => {
		expect(resolveTheme("system", true)).toBe("dark");
		expect(resolveTheme("system", false)).toBe("light");
	});
});
