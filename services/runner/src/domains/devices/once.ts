/** Remember the first successful result of an async fetch for the rest of the session. */
export function remember<T>(fetch: () => Promise<T>): () => Promise<T> {
	let value: T | undefined;
	let loaded = false;
	return async () => {
		if (!loaded) {
			value = await fetch();
			loaded = true;
		}
		return value as T;
	};
}
