import { controlMessageSchema } from "@yoqa/runner-client";
import { getActiveSession, isActiveSessionHeldByRun } from "../../domains/devices/active-session";

export type ControlWsData = {
	kind: "control";
};

/** Machine-readable control-channel errors surfaced to the Inspector. */
export type ControlWsErrorCode =
	| "NO_SESSION"
	| "HELD_BY_RUN"
	| "INVALID_JSON"
	| "INVALID_MESSAGE"
	| "POINTER_FAILED";

export function isControlUpgrade(pathname: string): boolean {
	return pathname === "/ws/control";
}

function error(code: ControlWsErrorCode, detail?: string): string {
	return JSON.stringify({
		ok: false,
		error: codeMessage(code),
		code,
		...(detail ? { detail } : {}),
	});
}

function codeMessage(code: ControlWsErrorCode): string {
	switch (code) {
		case "NO_SESSION":
			return "No active device session";
		case "HELD_BY_RUN":
			return "A run is using this device session. Cancel the run to interact manually.";
		case "INVALID_JSON":
			return "Invalid JSON";
		case "INVALID_MESSAGE":
			return "Invalid control message";
		case "POINTER_FAILED":
			return "Pointer event failed";
	}
}

export const controlWebSocket = {
	open(ws: { send: (data: string) => void }) {
		const active = getActiveSession();
		if (!active) {
			ws.send(error("NO_SESSION"));
			return;
		}
		ws.send(
			JSON.stringify({
				ok: true,
				type: "ready",
				deviceId: active.deviceId,
				platform: active.platform,
			}),
		);
	},

	async message(
		ws: { send: (data: string) => void },
		message: string | Buffer | ArrayBuffer | Uint8Array,
	) {
		const active = getActiveSession();
		if (!active) {
			ws.send(error("NO_SESSION"));
			return;
		}

		let parsed: unknown;
		try {
			const text =
				typeof message === "string"
					? message
					: Buffer.isBuffer(message)
						? message.toString("utf8")
						: new TextDecoder().decode(message);
			parsed = JSON.parse(text);
		} catch {
			ws.send(error("INVALID_JSON"));
			return;
		}

		const result = controlMessageSchema.safeParse(parsed);
		if (!result.success) {
			ws.send(error("INVALID_MESSAGE", result.error.message));
			return;
		}

		const msg = result.data;
		if (isActiveSessionHeldByRun()) {
			ws.send(error("HELD_BY_RUN"));
			return;
		}
		try {
			await active.session.pointerEvent(msg.phase, msg.x, msg.y, msg.seq);
			if (msg.phase === "end" || msg.phase === "begin") {
				ws.send(JSON.stringify({ ok: true, type: "ack", phase: msg.phase, seq: msg.seq }));
			}
		} catch (err) {
			const detail = err instanceof Error ? err.message : String(err);
			ws.send(error("POINTER_FAILED", detail));
		}
	},

	close(_ws: unknown, _code: number, _reason: string) {
		const active = getActiveSession();
		if (active?.session.isPointerActive()) {
			void active.session.pointerEvent("end", 500, 500, Number.MAX_SAFE_INTEGER).catch(() => {
				/* best-effort release */
			});
		}
	},
};
