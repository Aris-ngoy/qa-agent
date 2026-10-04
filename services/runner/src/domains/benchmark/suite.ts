export const BENCHMARK_SUITE_VERSION = 1;

export type BenchmarkTap = {
	x: number;
	y: number;
	id?: string;
	label?: string;
};

export type BenchmarkScreenArm = "vision" | "tree";

export type BenchmarkSuite = {
	/** Bump when taps or cases change so JSON runs stay comparable. */
	version: number;
	repeats: number;
	taps: BenchmarkTap[];
	cases: Array<{ caseId: string }>;
	passRepeats: number;
	/** Vision-first is the default arm. `tree` is screenshot + Screen every Agent step. */
	arms: BenchmarkScreenArm[];
};

/** Versioned Appium-lane gate suite. Hardware runs should keep this version. */
export const DEFAULT_BENCHMARK_SUITE: BenchmarkSuite = {
	version: BENCHMARK_SUITE_VERSION,
	repeats: 5,
	taps: [{ x: 500, y: 500 }],
	cases: [],
	passRepeats: 3,
	arms: ["vision"],
};

export function parseBenchmarkSuite(raw: unknown): BenchmarkSuite {
	if (!raw || typeof raw !== "object") {
		throw new Error("Benchmark suite must be an object");
	}
	const value = raw as Record<string, unknown>;
	const version = Number(value.version);
	const repeats = Number(value.repeats);
	const passRepeats = Number(value.passRepeats ?? 3);
	if (!Number.isInteger(version) || version < 1) {
		throw new Error("Benchmark suite version must be a positive integer");
	}
	if (!Number.isInteger(repeats) || repeats < 1) {
		throw new Error("Benchmark suite repeats must be a positive integer");
	}
	if (!Array.isArray(value.taps) || value.taps.length === 0) {
		throw new Error("Benchmark suite needs at least one tap");
	}
	const taps: BenchmarkTap[] = value.taps.map((tap, i) => {
		if (!tap || typeof tap !== "object") {
			throw new Error(`Benchmark suite tap ${i} is invalid`);
		}
		const row = tap as Record<string, unknown>;
		const x = Number(row.x);
		const y = Number(row.y);
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			throw new Error(`Benchmark suite tap ${i} needs x and y`);
		}
		return {
			x,
			y,
			...(typeof row.id === "string" ? { id: row.id } : {}),
			...(typeof row.label === "string" ? { label: row.label } : {}),
		};
	});
	const cases = Array.isArray(value.cases)
		? value.cases.flatMap((item) => {
				if (!item || typeof item !== "object") return [];
				const caseId = (item as { caseId?: unknown }).caseId;
				return typeof caseId === "string" && caseId.length > 0 ? [{ caseId }] : [];
			})
		: [];
	return {
		version,
		repeats,
		taps,
		cases,
		passRepeats: Number.isInteger(passRepeats) ? passRepeats : 3,
		arms: parseBenchmarkArms(value.arms),
	};
}

export function parseBenchmarkArms(raw: unknown): BenchmarkScreenArm[] {
	if (raw == null) return ["vision"];
	if (!Array.isArray(raw) || raw.length === 0) {
		throw new Error("Benchmark suite arms must be a non-empty list of vision | tree");
	}
	const arms: BenchmarkScreenArm[] = [];
	for (const item of raw) {
		if (item !== "vision" && item !== "tree") {
			throw new Error("Benchmark suite arms must be vision or tree");
		}
		if (!arms.includes(item)) arms.push(item);
	}
	return arms;
}
