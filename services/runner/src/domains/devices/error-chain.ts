/** One link of an error's `cause` chain, as plain JSON: name, message, own fields and stack. */
export type ErrorLink = {
	name: string;
	message: string;
	fields?: Record<string, unknown>;
	stack?: string;
};

const MAX_LINKS = 8;

/**
 * Walk `error` and its `cause`s into plain JSON, so a log line or an HTTP body carries the
 * whole story (e.g. Dead Session ← YoqaRunner unreachable ← usbmuxd listing) and not just
 * the outermost message.
 */
export function errorChain(error: unknown): ErrorLink[] {
	const links: ErrorLink[] = [];
	let current: unknown = error;
	while (current !== undefined && current !== null && links.length < MAX_LINKS) {
		if (!(current instanceof Error)) {
			links.push({ name: typeof current, message: String(current) });
			break;
		}
		const fields: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(current)) {
			if (key !== "cause" && value !== undefined) fields[key] = value;
		}
		links.push({
			name: current.name,
			message: current.message,
			...(Object.keys(fields).length > 0 ? { fields } : {}),
			...(current.stack ? { stack: current.stack } : {}),
		});
		current = current.cause;
	}
	return links;
}
