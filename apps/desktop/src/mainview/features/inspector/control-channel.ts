export type ControlAck = {
	kind: "ack";
	phase: string;
	seq: number;
};

export type ControlError = {
	kind: "error";
	message: string;
	detail?: string;
	code?: string;
};

/**
 * Parse one control-channel text payload. Pure so the Inspector's
 * ack/error handling stays unit-testable without a socket.
 * Returns null for payloads that carry no actionable state (e.g. ready).
 */
export function parseControlPayload(data: string): ControlAck | ControlError | null {
	let msg: unknown;
	try {
		msg = JSON.parse(data);
	} catch {
		return null;
	}
	if (!msg || typeof msg !== "object") return null;
	const record = msg as Record<string, unknown>;
	if (record.ok === false) {
		const message = typeof record.error === "string" ? record.error : "Live control failed";
		return {
			kind: "error",
			message,
			...(typeof record.detail === "string" ? { detail: record.detail } : {}),
			...(typeof record.code === "string" ? { code: record.code } : {}),
		};
	}
	if (record.ok === true && record.type === "ack") {
		if (typeof record.phase !== "string" || typeof record.seq !== "number") return null;
		return { kind: "ack", phase: record.phase, seq: record.seq };
	}
	return null;
}

/** Human-readable toast text for a parsed control error. */
export function controlErrorText(error: ControlError): string {
	const detail = error.detail ? `: ${error.detail}` : "";
	const code = error.code ? ` [${error.code}]` : "";
	return `${error.message}${detail}${code}`;
}
