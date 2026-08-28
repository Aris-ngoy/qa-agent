/** Named XML entities we decode. HTML-only names (e.g. nbsp) are left intact. */
const NAMED: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

/**
 * Decode XML entities in a single pass so `&amp;lt;` stays `&lt;` (no cascade).
 * Handles `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` and numeric `&#…;` / `&#x…;`.
 */
export function decodeXmlEntities(value: string): string {
	return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g, (entity, body: string) => {
		if (body.startsWith("#")) {
			const code =
				body[1] === "x" || body[1] === "X"
					? Number.parseInt(body.slice(2), 16)
					: Number.parseInt(body.slice(1), 10);
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
				return entity;
			}
			try {
				return String.fromCodePoint(code);
			} catch {
				return entity;
			}
		}
		return NAMED[body] ?? entity;
	});
}
