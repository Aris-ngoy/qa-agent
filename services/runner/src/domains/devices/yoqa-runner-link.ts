/**
 * The Mac's side of `YoqaRunner`'s wire protocol. Every command is one `POST /` with a
 * `{ "command", "commandId", ... }` body over a fresh tunnel (the runner closes the
 * connection after each reply), answered `{ "ok": true, "data" }` or
 * `{ "ok": false, "error": { "code", "message" } }`.
 *
 * Gestures are journaled on the runner by `commandId`. When a gesture's reply is lost on
 * the cable, the link asks `status` about that id and takes the recorded reply. It never
 * sends the gesture again, so a flaky cable can't double-tap.
 */

import type { Duplex } from "node:stream";

/** Opens one connection to the runner, e.g. a usbmuxd tunnel to its port on the phone. */
export type OpenRunnerTunnel = () => Promise<Duplex>;

/** How long a command may take before the runner counts as unreachable. */
const COMMAND_TIMEOUT_MS = 10_000;

/** How often a lost reply's `status` is asked again while the gesture is still running. */
const PENDING_POLL_MS = 100;

/** The runner answered, with an error. `code` is the runner's (`UNKNOWN_COMMAND`, …). */
export class YoqaRunnerCommandError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "YoqaRunnerCommandError";
	}
}

/** The runner could not be reached, or what answered was not the runner. */
export class YoqaRunnerUnreachableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "YoqaRunnerUnreachableError";
	}
}

export type YoqaRunnerLink = {
	/**
	 * Send one command and return its `data`. A `journaled` command (a gesture) whose reply
	 * is lost is resolved through `status`, never resent.
	 */
	send: (
		command: string,
		fields?: Record<string, unknown>,
		options?: { journaled?: boolean },
	) => Promise<unknown>;
};

type Envelope = { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };

/** The reply's `data`, or the runner's error; null when it isn't the runner's envelope. */
function unwrap(reply: Envelope): { data: unknown } | null {
	if (reply.ok === true) return { data: reply.data };
	if (reply.ok === false && typeof reply.error?.code === "string") {
		throw new YoqaRunnerCommandError(reply.error.code, String(reply.error.message ?? ""));
	}
	return null;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The reply's length once its head has arrived: head plus `Content-Length`, else unknown. */
function expectedLength(raw: Buffer): number | null {
	const split = raw.indexOf("\r\n\r\n");
	if (split < 0) return null;
	const length = raw
		.subarray(0, split)
		.toString("latin1")
		.match(/^content-length:\s*(\d+)\s*$/im)?.[1];
	return length ? split + 4 + Number(length) : null;
}

/** Write `request` and read the whole reply: up to `Content-Length`, else until close. */
function roundTrip(tunnel: Duplex, request: string, timeoutMs: number, command: string) {
	return new Promise<Buffer>((resolve, reject) => {
		let raw = Buffer.alloc(0);
		const timer = setTimeout(() => {
			tunnel.destroy();
			reject(
				new YoqaRunnerUnreachableError(
					`YoqaRunner did not answer ${command} within ${timeoutMs} ms`,
				),
			);
		}, timeoutMs);
		const finish = () => {
			clearTimeout(timer);
			resolve(raw);
		};
		tunnel.on("data", (chunk: Buffer) => {
			raw = Buffer.concat([raw, chunk]);
			const length = expectedLength(raw);
			if (length !== null && raw.length >= length) finish();
		});
		tunnel.once("end", finish);
		tunnel.once("close", () => {
			if (raw.length > 0) return finish();
			clearTimeout(timer);
			reject(
				new YoqaRunnerUnreachableError(
					`YoqaRunner closed the connection before answering ${command}`,
				),
			);
		});
		tunnel.once("error", (error) => {
			clearTimeout(timer);
			reject(new YoqaRunnerUnreachableError(`YoqaRunner connection failed: ${error.message}`));
		});
		// A usbmuxd tunnel arrives paused; read only once listening.
		tunnel.resume();
		tunnel.write(request);
	});
}

/** The reply body, or null when the bytes aren't an HTTP response. */
function httpBody(raw: Buffer): string | null {
	const split = raw.indexOf("\r\n\r\n");
	if (!raw.subarray(0, 7).equals(Buffer.from("HTTP/1.")) || split < 0) return null;
	const end = expectedLength(raw) ?? raw.length;
	return raw.subarray(split + 4, end).toString("utf8");
}

export function createYoqaRunnerLink(
	openTunnel: OpenRunnerTunnel,
	options: { timeoutMs?: number } = {},
): YoqaRunnerLink {
	const timeoutMs = options.timeoutMs ?? COMMAND_TIMEOUT_MS;

	/** One request over a fresh tunnel. `sent` tells a lost reply from a tunnel that never opened. */
	const exchange = async (command: string, payload: string, sent: { value: boolean }) => {
		const request = [
			"POST / HTTP/1.1",
			"Host: 127.0.0.1",
			"Content-Type: application/json",
			`Content-Length: ${Buffer.byteLength(payload)}`,
			"Connection: close",
			"",
			payload,
		].join("\r\n");

		let tunnel: Duplex;
		try {
			tunnel = await openTunnel();
		} catch (error) {
			throw new YoqaRunnerUnreachableError(`Cannot reach YoqaRunner: ${errorMessage(error)}`);
		}
		sent.value = true;
		try {
			return await roundTrip(tunnel, request, timeoutMs, command);
		} finally {
			tunnel.destroy();
		}
	};

	const send: YoqaRunnerLink["send"] = async (command, fields = {}, sendOptions = {}) => {
		const commandId = crypto.randomUUID();
		const payload = JSON.stringify({ ...fields, command, commandId });
		const sent = { value: false };
		let raw: Buffer;
		try {
			raw = await exchange(command, payload, sent);
		} catch (error) {
			if (!sendOptions.journaled || !sent.value) throw error;
			return resolveLostReply(command, commandId, error);
		}

		const body = httpBody(raw);
		let reply: Envelope;
		try {
			reply = body === null ? {} : JSON.parse(body);
		} catch {
			reply = {};
		}
		const unwrapped = unwrap(reply);
		if (unwrapped) return unwrapped.data;
		throw new YoqaRunnerUnreachableError(
			`Something other than YoqaRunner answered ${command}: ${raw.toString("utf8").slice(0, 120)}`,
		);
	};

	/**
	 * A gesture went out and its reply didn't come back. Ask `status` what the runner
	 * recorded for its id: the reply once done, or `unknown` when it never arrived.
	 */
	const resolveLostReply = async (command: string, commandId: string, lost: unknown) => {
		const deadline = performance.now() + timeoutMs;
		while (true) {
			let status: { command?: { state?: unknown; reply?: Envelope } };
			try {
				status = (await send("status", { statusCommandId: commandId })) as typeof status;
			} catch {
				throw lost;
			}
			const state = status?.command?.state;
			if (state === "done") {
				const unwrapped = unwrap(status.command?.reply ?? {});
				if (unwrapped) return unwrapped.data;
				throw new YoqaRunnerUnreachableError(`YoqaRunner recorded no reply for ${command}`);
			}
			if (state !== "pending") {
				// The runner answered status, so it is reachable: the command alone was lost.
				throw new YoqaRunnerCommandError(
					"COMMAND_LOST",
					`${command} never reached YoqaRunner and was not sent again (${errorMessage(lost)})`,
				);
			}
			if (performance.now() >= deadline) {
				throw new YoqaRunnerUnreachableError(
					`YoqaRunner was still running ${command} after ${timeoutMs} ms`,
				);
			}
			await Bun.sleep(PENDING_POLL_MS);
		}
	};

	return { send };
}
