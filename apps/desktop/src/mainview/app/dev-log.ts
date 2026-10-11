/// <reference types="vite/client" />

type Level = "log" | "error";

/** A JSON-safe copy of `value`; Errors keep name, message, stack and own fields (status, body). */
function plain(value: unknown): unknown {
	try {
		return JSON.parse(
			JSON.stringify(value, (_key, item: unknown) => {
				if (!(item instanceof Error)) return item;
				return { ...item, name: item.name, message: item.message, stack: item.stack };
			}),
		);
	} catch {
		return String(value);
	}
}

function emit(level: Level, message: string, data: unknown): void {
	if (!import.meta.env.DEV) return;
	const line = `[yoqa] ${message}`;
	const write = level === "error" ? console.error : console.log;
	if (data === undefined) write(line);
	else write(line, data);
	// The Electrobun webview console is not in the terminal; Vite's HMR socket carries it there.
	import.meta.hot?.send("yoqa:dev-log", { level, message, data: plain(data) });
}

/** Dev builds only: log to the webview console and the `bun run dev` terminal. */
export function devLog(message: string, data?: unknown): void {
	emit("log", message, data);
}

/** Dev builds only: like `devLog`, as an error. */
export function devError(message: string, data?: unknown): void {
	emit("error", message, data);
}
