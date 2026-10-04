import { describe, expect, test } from "bun:test";
import {
	IDB_CLIENT_HOME,
	IDB_COMPANION_HOME,
	MISSING_IDB_MESSAGE,
	requireIdbBins,
	resolveIdbClientPath,
	resolveIdbCompanionPath,
} from "./idb-companion";

describe("resolveIdbCompanionPath", () => {
	test("YOQA_IDB_COMPANION wins over home and PATH", () => {
		expect(
			resolveIdbCompanionPath(
				{ YOQA_IDB_COMPANION: "/opt/idb_companion" },
				() => true,
				() => "/usr/local/bin/idb_companion",
			),
		).toBe("/opt/idb_companion");
	});

	test("uses ~/.yoqa/idb when the official binary is already there", () => {
		expect(
			resolveIdbCompanionPath(
				{},
				(path) => path === IDB_COMPANION_HOME,
				() => "/usr/local/bin/idb_companion",
			),
		).toBe(IDB_COMPANION_HOME);
	});

	test("falls back to PATH", () => {
		expect(
			resolveIdbCompanionPath(
				{},
				() => false,
				(name) => (name === "idb_companion" ? "/opt/homebrew/bin/idb_companion" : null),
			),
		).toBe("/opt/homebrew/bin/idb_companion");
	});
});

describe("requireIdbBins", () => {
	test("throws a GitHub-release install hint — not brew trust", () => {
		expect(() =>
			requireIdbBins(
				{},
				() => false,
				() => null,
			),
		).toThrow(MISSING_IDB_MESSAGE);
		expect(() =>
			requireIdbBins(
				{},
				() => false,
				() => null,
			),
		).toThrow(/Do not use `brew trust/);
	});

	test("returns companion and client when both resolve", () => {
		expect(
			requireIdbBins(
				{ YOQA_IDB_COMPANION: "/c", YOQA_IDB: "/i" },
				() => false,
				() => null,
			),
		).toEqual({ companion: "/c", client: "/i" });
	});

	test("client prefers ~/.yoqa/idb/venv when present", () => {
		expect(
			resolveIdbClientPath(
				{},
				(path) => path === IDB_CLIENT_HOME,
				() => "/usr/bin/idb",
			),
		).toBe(IDB_CLIENT_HOME);
	});
});
