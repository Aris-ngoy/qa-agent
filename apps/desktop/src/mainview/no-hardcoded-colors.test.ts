import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Real brand colors (the Yoqa mark and third-party logos) that are the same in every theme. */
const BRAND_MARK_FILES = new Set([
	"features/splash/components/yoqa-mark.tsx",
	"features/providers/components/provider-logos.tsx",
	"features/settings/components/brand-marks.tsx",
]);

const PALETTE =
	"slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PROPS = "bg|text|border|ring|from|to|via|fill|stroke|divide|outline|decoration";

/** Colors that cannot follow the theme: hex, rgb(a), white/black, and light-only palette shades. */
const HARDCODED = [
	/#[0-9a-fA-F]{3,8}\b/,
	/\b(rgba?|hsla?)\(/,
	new RegExp(`\\b(${PROPS})-(white|black)\\b`),
	new RegExp(`\\b(${PROPS})-(${PALETTE})-(50|100|200|300|800|900|950)\\b`),
];

function isComment(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function hardcodedColorLines(): string[] {
	const found: string[] = [];
	for (const file of new Bun.Glob("**/*.{ts,tsx}").scanSync(import.meta.dir)) {
		if (file.endsWith(".test.ts") || BRAND_MARK_FILES.has(file)) continue;
		const lines = readFileSync(join(import.meta.dir, file), "utf8").split("\n");
		lines.forEach((line, index) => {
			if (!isComment(line) && HARDCODED.some((pattern) => pattern.test(line))) {
				found.push(`${file}:${index + 1}`);
			}
		});
	}
	return found;
}

describe("theming", () => {
	test("components use semantic color tokens, not hardcoded colors", () => {
		expect(hardcodedColorLines()).toEqual([]);
	});
});
