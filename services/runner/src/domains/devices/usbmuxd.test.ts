import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { type Server, type Socket, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsbmuxError, connectUsbmux, listUsbmuxDevices } from "./usbmuxd";

const UDID = "00008120-000E6D813E2A601E";

/** One `ListDevices` entry the way usbmuxd prints it. */
function attached(deviceId: number, serial: string, connectionType: "USB" | "Network"): string {
	return `<dict><key>DeviceID</key><integer>${deviceId}</integer><key>MessageType</key><string>Attached</string><key>Properties</key><dict><key>ConnectionType</key><string>${connectionType}</string><key>DeviceID</key><integer>${deviceId}</integer><key>LocationID</key><integer>0</integer><key>ProductID</key><integer>4776</integer><key>SerialNumber</key><string>${serial}</string></dict></dict>`;
}

function plist(body: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${body}\n</plist>\n`;
}

function frame(xml: string, tag: number): Buffer {
	const body = Buffer.from(xml);
	const header = Buffer.alloc(16);
	header.writeUInt32LE(16 + body.length, 0);
	header.writeUInt32LE(1, 4);
	header.writeUInt32LE(8, 8);
	header.writeUInt32LE(tag, 12);
	return Buffer.concat([header, body]);
}

type Received = { messageType: string; deviceId?: number; portNumber?: number; tag: number };

/**
 * Stands in for usbmuxd at its wire protocol: 16-byte little-endian headers around XML
 * plists. `ListDevices` answers `devices`. `Connect` answers `connectResult`; on 0 the
 * socket becomes the tunnel, which answers whatever `tunnel` returns for the bytes it got.
 */
function fakeUsbmuxd(
	options: {
		devices?: string[];
		connectResult?: number;
		tunnel?: (bytes: string) => string;
	} = {},
) {
	const dir = mkdtempSync(join(tmpdir(), "yoqa-usbmuxd-"));
	const path = join(dir, "usbmuxd");
	const received: Received[] = [];
	const server: Server = createServer((socket: Socket) => {
		let buffer = Buffer.alloc(0);
		let tunneled = false;
		socket.on("data", (chunk) => {
			if (tunneled) {
				socket.end(options.tunnel?.(chunk.toString()) ?? "");
				return;
			}
			buffer = Buffer.concat([buffer, chunk]);
			if (buffer.length < 16 || buffer.length < buffer.readUInt32LE(0)) return;
			const tag = buffer.readUInt32LE(12);
			const xml = buffer.subarray(16, buffer.readUInt32LE(0)).toString();
			const integer = (key: string) => {
				const match = xml.match(new RegExp(`<key>${key}</key>\\s*<integer>(\\d+)</integer>`));
				return match?.[1] ? Number(match[1]) : undefined;
			};
			const messageType = xml.match(/<key>MessageType<\/key>\s*<string>(\w+)<\/string>/)?.[1] ?? "";
			received.push({
				messageType,
				deviceId: integer("DeviceID"),
				portNumber: integer("PortNumber"),
				tag,
			});
			if (messageType === "ListDevices") {
				const list = (options.devices ?? []).join("");
				socket.end(frame(plist(`<dict><key>DeviceList</key><array>${list}</array></dict>`), tag));
			} else if (messageType === "Connect") {
				const result = options.connectResult ?? 0;
				socket.write(
					frame(
						plist(
							`<dict><key>MessageType</key><string>Result</string><key>Number</key><integer>${result}</integer></dict>`,
						),
						tag,
					),
				);
				if (result === 0) tunneled = true;
				else socket.end();
			}
		});
	});
	const listening = new Promise<void>((resolve) => server.listen(path, resolve));
	const close = () => {
		server.close();
		rmSync(dir, { recursive: true, force: true });
	};
	return { path, received, listening, close };
}

const servers: Array<{ close: () => void }> = [];
afterEach(() => {
	for (const server of servers.splice(0)) server.close();
});

async function start(options: Parameters<typeof fakeUsbmuxd>[0]) {
	const fake = fakeUsbmuxd(options);
	servers.push(fake);
	await fake.listening;
	return fake;
}

async function readAll(socket: Socket): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of socket) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString();
}

describe("listUsbmuxDevices", () => {
	test("lists the devices usbmuxd knows, with their connection type", async () => {
		const fake = await start({
			devices: [attached(7, UDID, "USB"), attached(9, "00008150-000504A22638401C", "Network")],
		});
		expect(await listUsbmuxDevices(fake.path)).toEqual([
			{ deviceId: 7, udid: UDID, connectionType: "USB" },
			{ deviceId: 9, udid: "00008150-000504A22638401C", connectionType: "Network" },
		]);
	});

	test("explains when usbmuxd isn't there", async () => {
		await expect(listUsbmuxDevices("/nonexistent/usbmuxd")).rejects.toThrow(UsbmuxError);
	});
});

describe("connectUsbmux", () => {
	test("opens a tunnel to the port on the wired phone with that UDID", async () => {
		const fake = await start({
			devices: [attached(9, UDID, "Network"), attached(7, UDID, "USB")],
			tunnel: (bytes) => `echo:${bytes}`,
		});
		const socket = await connectUsbmux(UDID, 8100, fake.path);
		socket.write("ping");
		expect(await readAll(socket)).toBe("echo:ping");
		const connect = fake.received.find((message) => message.messageType === "Connect");
		// usbmuxd takes the port in network byte order: 8100 is 0x1FA4, sent as 0xA41F.
		expect(connect).toMatchObject({ deviceId: 7, portNumber: 0xa41f });
	});

	test("matches a UDID that usbmuxd prints without its dash", async () => {
		const fake = await start({
			devices: [attached(7, UDID.replace("-", ""), "USB")],
			tunnel: () => "ok",
		});
		const socket = await connectUsbmux(UDID.toLowerCase(), 8100, fake.path);
		socket.write("x");
		expect(await readAll(socket)).toBe("ok");
	});

	test("a phone that is only on Wi-Fi is not reachable", async () => {
		const fake = await start({ devices: [attached(9, UDID, "Network")] });
		const failure = connectUsbmux(UDID, 8100, fake.path);
		await expect(failure).rejects.toThrow(UsbmuxError);
		await expect(failure).rejects.toThrow(/not on a USB cable/);
	});

	test("a refused port says which port", async () => {
		const fake = await start({ devices: [attached(7, UDID, "USB")], connectResult: 3 });
		const failure = connectUsbmux(UDID, 8100, fake.path);
		await expect(failure).rejects.toThrow(UsbmuxError);
		await expect(failure).rejects.toThrow(/port 8100.*refused/);
	});
});
