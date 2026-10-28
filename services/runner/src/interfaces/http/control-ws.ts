import { type ControlScreenChangedMessage, controlMessageSchema } from "@yoqa/runner-client";
import {
	getActiveSession,
	isActiveSessionHeldByRun,
	onActiveScreenChanged,
} from "../../domains/devices/active-session";

export type ControlWsData = {
	kind: "control";
};

export function isControlUpgrade(pathname: string): boolean {
	return pathname === "/ws/control";
}

/** Each open control socket's unsubscribe from the screen-changed signal. */
const listening = new Map<object, () => void>();

const SCREEN_CHANGED = JSON.stringify({
	ok: true,
	type: "screen-changed",
} satisfies ControlScreenChangedMessage);

export const controlWebSocket = {
	open(ws: { send: (data: string) => void }) {
		// The Inspector reads the Screen again on it, whichever session is active then.
		listening.set(
			ws,
			onActiveScreenChanged(() => ws.send(SCREEN_CHANGED)),
		);
		const active = getActiveSession();
		if (!active) {
			ws.send(JSON.stringify({ ok: false, error: "No active device session" }));
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
			ws.send(JSON.stringify({ ok: false, error: "No active device session" }));
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
			ws.send(JSON.stringify({ ok: false, error: "Invalid JSON" }));
			return;
		}

		const result = controlMessageSchema.safeParse(parsed);
		if (!result.success) {
			ws.send(
				JSON.stringify({
					ok: false,
					error: "Invalid control message",
					detail: result.error.message,
				}),
			);
			return;
		}

		const msg = result.data;
		if (isActiveSessionHeldByRun()) {
			ws.send(
				JSON.stringify({
					ok: false,
					error: "A run is using this device session. Cancel the run to interact manually.",
				}),
			);
			return;
		}
		try {
			await active.session.pointerEvent(msg.phase, msg.x, msg.y, msg.seq);
			if (msg.phase === "end" || msg.phase === "begin") {
				ws.send(JSON.stringify({ ok: true, type: "ack", phase: msg.phase, seq: msg.seq }));
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			ws.send(JSON.stringify({ ok: false, error: "Pointer event failed", detail }));
		}
	},

	close(ws: object, _code: number, _reason: string) {
		listening.get(ws)?.();
		listening.delete(ws);
		const active = getActiveSession();
		if (active?.session.isPointerActive()) {
			void active.session.pointerEvent("end", 500, 500, Number.MAX_SAFE_INTEGER).catch(() => {
				/* best-effort release */
			});
		}
	},

	/** How many control sockets hear the screen-changed signal. */
	listening(): number {
		return listening.size;
	},
};
