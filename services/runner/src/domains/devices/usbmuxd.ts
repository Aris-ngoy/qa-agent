/**
 * A client for `usbmuxd`, the Mac daemon that multiplexes TCP onto a cabled iPhone. Each
 * message is a 16-byte little-endian header (length, version 1, type 8 = plist, tag)
 * around an XML plist. `ListDevices` maps a UDID to usbmuxd's DeviceID. `Connect` turns
 * the socket into a raw tunnel to a TCP port on the phone, which is how the Mac reaches
 * `YoqaRunner` listening on the phone's loopback.
 */

import { type Socket, createConnection } from "node:net";

export const USBMUXD_SOCKET = "/var/run/usbmuxd";

const HEADER_BYTES = 16;
const PLIST_VERSION = 1;
const PLIST_MESSAGE = 8;

/** usbmuxd's `Result` numbers for `Connect`. */
const RESULT_TEXT: Record<number, string> = {
	1: "was a bad command",
	2: "named an unknown device",
	3: "was refused (nothing is listening there)",
	6: "used an unsupported protocol version",
};

export type UsbmuxDevice = {
	deviceId: number;
	udid: string;
	connectionType: string;
};

/** usbmuxd is unreachable, the phone isn't on a cable, or the port can't be opened. */
export class UsbmuxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UsbmuxError";
	}
}

type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function unescapeXml(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function encodePlist(dict: Record<string, string | number>): string {
	const entries = Object.entries(dict)
		.map(([key, value]) =>
			typeof value === "number"
				? `<key>${key}</key><integer>${value}</integer>`
				: `<key>${key}</key><string>${escapeXml(value)}</string>`,
		)
		.join("");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>${entries}</dict></plist>\n`;
}

/** The subset of XML plists usbmuxd sends: dict, array, string, integer, real, bool, data. */
function decodePlist(xml: string): PlistValue {
	const tokens = xml.matchAll(/<(\/?)(\w+)(\/?)>([^<]*)/g);
	const iterator = tokens[Symbol.iterator]();
	const next = () => {
		for (;;) {
			const step = iterator.next();
			if (step.done) throw new UsbmuxError("usbmuxd sent a truncated plist");
			const [, closing, tag, selfClosing, text] = step.value;
			if (tag === "plist" || tag === "xml") continue;
			return {
				closing: closing === "/",
				tag: tag ?? "",
				selfClosing: selfClosing === "/",
				text: text ?? "",
			};
		}
	};
	const value = (open: ReturnType<typeof next>): PlistValue => {
		switch (open.tag) {
			case "true":
				return true;
			case "false":
				return false;
			case "dict": {
				const dict: { [key: string]: PlistValue } = {};
				if (open.selfClosing) return dict;
				for (;;) {
					const key = next();
					if (key.closing) return dict;
					next(); // </key>
					dict[unescapeXml(key.text)] = value(next());
				}
			}
			case "array": {
				const array: PlistValue[] = [];
				if (open.selfClosing) return array;
				for (;;) {
					const item = next();
					if (item.closing) return array;
					array.push(value(item));
				}
			}
			default: {
				if (open.selfClosing) return "";
				next(); // the closing tag
				if (open.tag === "integer" || open.tag === "real") return Number(open.text);
				return unescapeXml(open.text);
			}
		}
	};
	return value(next());
}

function frameMessage(dict: Record<string, string | number>, tag: number): Buffer {
	const body = Buffer.from(encodePlist(dict));
	const header = Buffer.alloc(HEADER_BYTES);
	header.writeUInt32LE(HEADER_BYTES + body.length, 0);
	header.writeUInt32LE(PLIST_VERSION, 4);
	header.writeUInt32LE(PLIST_MESSAGE, 8);
	header.writeUInt32LE(tag, 12);
	return Buffer.concat([header, body]);
}

function usbmuxRequest(messageType: string, extra: Record<string, string | number> = {}) {
	return {
		MessageType: messageType,
		ClientVersionString: "yoqa",
		ProgName: "yoqa",
		kLibUSBMuxVersion: 3,
		...extra,
	};
}

function openUsbmuxd(socketPath: string): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const socket = createConnection(socketPath);
		socket.once("connect", () => {
			socket.off("error", onError);
			resolve(socket);
		});
		const onError = (error: Error) =>
			reject(new UsbmuxError(`Cannot reach usbmuxd at ${socketPath}: ${error.message}`));
		socket.once("error", onError);
	});
}

/**
 * Send one message and read its one reply. Any bytes after the reply stay on the socket,
 * which matters after a successful `Connect`: from then on they belong to the phone.
 */
function exchange(socket: Socket, request: Buffer): Promise<{ [key: string]: PlistValue }> {
	return new Promise((resolve, reject) => {
		let buffer = Buffer.alloc(0);
		const cleanup = () => {
			socket.off("data", onData);
			socket.off("error", onError);
			socket.off("close", onClose);
		};
		const onData = (chunk: Buffer) => {
			buffer = Buffer.concat([buffer, chunk]);
			if (buffer.length < HEADER_BYTES) return;
			const length = buffer.readUInt32LE(0);
			if (buffer.length < length) return;
			cleanup();
			socket.pause();
			const rest = buffer.subarray(length);
			if (rest.length > 0) socket.unshift(rest);
			try {
				const reply = decodePlist(buffer.subarray(HEADER_BYTES, length).toString("utf8"));
				if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
					throw new UsbmuxError("usbmuxd replied with something other than a dictionary");
				}
				resolve(reply);
			} catch (error) {
				reject(error);
			}
		};
		const onError = (error: Error) => {
			cleanup();
			reject(new UsbmuxError(`usbmuxd: ${error.message}`));
		};
		const onClose = () => {
			cleanup();
			reject(new UsbmuxError("usbmuxd closed the connection before replying"));
		};
		socket.on("data", onData);
		socket.once("error", onError);
		socket.once("close", onClose);
		socket.write(request);
	});
}

/** Every device usbmuxd knows, cabled (`USB`) or not (`Network`). */
export async function listUsbmuxDevices(socketPath = USBMUXD_SOCKET): Promise<UsbmuxDevice[]> {
	const socket = await openUsbmuxd(socketPath);
	try {
		const reply = await exchange(socket, frameMessage(usbmuxRequest("ListDevices"), 1));
		const list = Array.isArray(reply.DeviceList) ? reply.DeviceList : [];
		const devices: UsbmuxDevice[] = [];
		for (const entry of list) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
			const properties = entry.Properties;
			if (!properties || typeof properties !== "object" || Array.isArray(properties)) continue;
			const deviceId = Number(properties.DeviceID ?? entry.DeviceID);
			const udid = String(properties.SerialNumber ?? "");
			if (!Number.isFinite(deviceId) || !udid) continue;
			devices.push({ deviceId, udid, connectionType: String(properties.ConnectionType ?? "") });
		}
		return devices;
	} finally {
		socket.destroy();
	}
}

/** UDIDs compared without case or dashes: usbmuxd may print `00008120000E…` for `00008120-000E…`. */
function sameUdid(a: string, b: string): boolean {
	const plain = (udid: string) => udid.replace(/-/g, "").toUpperCase();
	return plain(a) === plain(b);
}

/**
 * Open a raw TCP tunnel to `port` on the cabled phone with this UDID. The returned socket
 * talks straight to whatever listens on the phone's loopback at that port. It is paused:
 * call `resume()` once a reader is listening.
 */
export async function connectUsbmux(
	udid: string,
	port: number,
	socketPath = USBMUXD_SOCKET,
): Promise<Socket> {
	const devices = await listUsbmuxDevices(socketPath);
	const wired = devices.find(
		(device) => sameUdid(device.udid, udid) && device.connectionType === "USB",
	);
	if (!wired) {
		const listed = devices.some((device) => sameUdid(device.udid, udid));
		throw new UsbmuxError(
			listed
				? `iPhone ${udid} is not on a USB cable (usbmuxd lists it over the network only). Connect it with a cable.`
				: `usbmuxd does not list iPhone ${udid}. Connect it with a cable, unlock it and trust this Mac.`,
		);
	}
	const socket = await openUsbmuxd(socketPath);
	try {
		// usbmuxd takes the port in network byte order.
		const portNumber = ((port & 0xff) << 8) | ((port >> 8) & 0xff);
		const reply = await exchange(
			socket,
			frameMessage(
				usbmuxRequest("Connect", { DeviceID: wired.deviceId, PortNumber: portNumber }),
				2,
			),
		);
		const result = Number(reply.Number);
		if (result !== 0) {
			const reason = RESULT_TEXT[result] ?? `failed with usbmuxd result ${result}`;
			throw new UsbmuxError(`Connecting to port ${port} on iPhone ${udid} ${reason}`);
		}
		// Left paused, so no tunnel byte is lost: the reader resumes it once it is listening.
		return socket;
	} catch (error) {
		socket.destroy();
		throw error;
	}
}
