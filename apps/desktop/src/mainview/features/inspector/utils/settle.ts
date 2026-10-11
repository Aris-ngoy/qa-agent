export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * `work()`'s value, or what it threw. Keeps try/catch out of components: the React
 * Compiler skips any component with conditionals inside a try block.
 */
export async function settle<T>(work: () => Promise<T>): Promise<Settled<T>> {
	try {
		return { ok: true, value: await work() };
	} catch (error) {
		return { ok: false, error };
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
