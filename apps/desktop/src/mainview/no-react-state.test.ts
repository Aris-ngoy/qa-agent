import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** React's own state hooks; Legend-State (`useObservable`, `observable`, `useValue`) holds state here. */
const REACT_STATE = /\b(useState|useReducer|useSyncExternalStore)\s*[<(]/;

function reactStateLines(): string[] {
	const found: string[] = [];
	for (const file of new Bun.Glob("**/*.{ts,tsx}").scanSync(import.meta.dir)) {
		if (file.endsWith(".test.ts")) continue;
		const lines = readFileSync(join(import.meta.dir, file), "utf8").split("\n");
		lines.forEach((line, index) => {
			if (REACT_STATE.test(line)) found.push(`${file}:${index + 1}`);
		});
	}
	return found;
}

describe("state", () => {
	test("components keep state in Legend-State, not React state hooks", () => {
		expect(reactStateLines()).toEqual([]);
	});
});
