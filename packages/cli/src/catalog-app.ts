export type CatalogAppRef = {
	id: string;
	prefix: string;
	name: string;
};

/** Match a CLI app argument to a catalog app (prefix is case-insensitive). */
export function findCatalogApp<T extends CatalogAppRef>(
	apps: T[],
	prefixOrId: string,
): T | undefined {
	const needle = prefixOrId.trim();
	if (!needle) return undefined;
	const lower = needle.toLowerCase();
	return (
		apps.find((app) => app.prefix === needle) ??
		apps.find((app) => app.prefix.toLowerCase() === lower) ??
		apps.find((app) => app.id === needle)
	);
}
