import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Device } from "@yoqa/runner-client";
import type { ListDevicesOptions } from "./models";

async function runCommand(
	command: string[],
	options?: { env?: Record<string, string> },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
		const proc = Bun.spawn(command, {
			env: options?.env ? { ...process.env, ...options.env } : process.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { stdout, stderr, exitCode };
	} catch {
		return { stdout: "", stderr: `failed to spawn: ${command[0]}`, exitCode: 127 };
	}
}

function androidSdkRoot(): string | null {
	const fromEnv = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
	if (fromEnv?.trim()) return fromEnv.trim();
	const fallback = join(process.env.HOME ?? "", "Library/Android/sdk");
	return fallback;
}

async function resolveTool(candidates: string[]): Promise<string | null> {
	for (const candidate of candidates) {
		if (!candidate) continue;
		const { exitCode } = await runCommand(["test", "-x", candidate]);
		if (exitCode === 0) return candidate;
	}
	return null;
}

async function resolveAdb(): Promise<string | null> {
	const sdk = androidSdkRoot();
	return resolveTool([...(sdk ? [join(sdk, "platform-tools/adb")] : []), "adb"]);
}

async function resolveEmulator(): Promise<string | null> {
	const sdk = androidSdkRoot();
	return resolveTool([...(sdk ? [join(sdk, "emulator/emulator")] : []), "emulator"]);
}

function formatIosVersion(version: string): string {
	const trimmed = version.trim();
	if (!trimmed) return "iOS";
	if (/^iOS\b/i.test(trimmed)) return trimmed;
	return `iOS ${trimmed}`;
}

function formatAndroidVersion(apiOrVersion: string): string {
	const trimmed = apiOrVersion.trim();
	if (!trimmed) return "Android";
	if (/^Android\b/i.test(trimmed)) return trimmed;
	if (/^API\b/i.test(trimmed)) return trimmed;
	// AVD system images expose API levels (e.g. 36, 36.1), not marketing versions
	if (/^\d+(\.\d+)?$/.test(trimmed)) return `API ${trimmed}`;
	return `Android ${trimmed}`;
}

function titleCaseWords(value: string): string {
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => {
			if (/^[a-z]$/i.test(word)) return word.toUpperCase();
			if (/^\d/.test(word)) return word;
			return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
		})
		.join(" ");
}

function runtimeVersionFromIdentifier(runtimeId: string): string {
	// com.apple.CoreSimulator.SimRuntime.iOS-26-3 → 26.3
	const match = runtimeId.match(/iOS-([\d-]+)$/i);
	if (!match?.[1]) return "iOS";
	return formatIosVersion(match[1].replace(/-/g, "."));
}

type SimctlDevice = {
	udid?: string;
	name?: string;
	state?: string;
	isAvailable?: boolean;
	deviceTypeIdentifier?: string;
};

type SimctlListJson = {
	devices?: Record<string, SimctlDevice[]>;
};

async function listIosSimulators(includeUnavailable: boolean): Promise<Device[]> {
	const { stdout, exitCode } = await runCommand([
		"xcrun",
		"simctl",
		"list",
		"devices",
		"available",
		"-j",
	]);
	if (exitCode !== 0) return [];

	let parsed: SimctlListJson;
	try {
		parsed = JSON.parse(stdout) as SimctlListJson;
	} catch {
		return [];
	}

	const devices: Device[] = [];
	for (const [runtimeId, runtimeDevices] of Object.entries(parsed.devices ?? {})) {
		if (!/iOS/i.test(runtimeId)) continue;
		const osVersion = runtimeVersionFromIdentifier(runtimeId);
		for (const device of runtimeDevices) {
			if (!device.udid || !device.name) continue;
			if (device.isAvailable === false) continue;
			const state = device.state ?? "Unknown";
			if (!includeUnavailable && state !== "Booted") continue;
			devices.push({
				id: device.udid,
				name: device.name,
				osVersion,
				platform: "ios",
				kind: "simulator",
				state,
				model: device.deviceTypeIdentifier?.split(".").pop()?.replace(/-/g, " "),
			});
		}
	}

	return devices.sort((a, b) => {
		if (a.state === "Booted" && b.state !== "Booted") return -1;
		if (b.state === "Booted" && a.state !== "Booted") return 1;
		return a.name.localeCompare(b.name);
	});
}

type DevicectlHardware = {
	udid?: string;
	marketingName?: string;
	deviceType?: string;
	platform?: string;
	reality?: string;
	productType?: string;
};

type DevicectlDeviceProperties = {
	name?: string;
	osVersionNumber?: string;
};

type DevicectlConnection = {
	tunnelState?: string;
	pairingState?: string;
	transportType?: string;
};

type DevicectlDevice = {
	hardwareProperties?: DevicectlHardware;
	deviceProperties?: DevicectlDeviceProperties;
	connectionProperties?: DevicectlConnection;
	identifier?: string;
};

type DevicectlListJson = {
	result?: {
		devices?: DevicectlDevice[];
	};
};

function isPhoneOrTablet(deviceType: string | undefined): boolean {
	if (!deviceType) return false;
	return /^(iPhone|iPad)$/i.test(deviceType);
}

function physicalIosState(connection: DevicectlConnection | undefined): string {
	const tunnel = connection?.tunnelState?.toLowerCase() ?? "";
	if (tunnel.includes("connected")) return "connected";
	if (tunnel.includes("unavailable")) return "unavailable";
	if (tunnel.includes("disconnected")) return "disconnected";
	if (connection?.pairingState === "paired") return "paired";
	return tunnel || connection?.pairingState || "unknown";
}

async function listIosPhysicalDevices(includeUnavailable: boolean): Promise<Device[]> {
	const dir = await mkdtemp(join(tmpdir(), "yoqa-devices-"));
	const jsonPath = join(dir, "devices.json");
	try {
		const { exitCode } = await runCommand([
			"xcrun",
			"devicectl",
			"list",
			"devices",
			"--json-output",
			jsonPath,
		]);
		if (exitCode !== 0) return [];

		let parsed: DevicectlListJson;
		try {
			parsed = JSON.parse(await readFile(jsonPath, "utf8")) as DevicectlListJson;
		} catch {
			return [];
		}

		const devices: Device[] = [];
		for (const item of parsed.result?.devices ?? []) {
			const hardware = item.hardwareProperties;
			const props = item.deviceProperties;
			if (!hardware?.udid) continue;
			if (hardware.reality && hardware.reality !== "physical") continue;
			if (!isPhoneOrTablet(hardware.deviceType)) continue;
			if (hardware.platform && !/^iOS$/i.test(hardware.platform)) continue;

			const state = physicalIosState(item.connectionProperties);
			if (!includeUnavailable && state === "unavailable") continue;

			const modelName = hardware.marketingName ?? hardware.productType ?? "iPhone";
			const owner = props?.name?.trim() || undefined;

			devices.push({
				id: hardware.udid,
				name: modelName,
				owner,
				osVersion: formatIosVersion(props?.osVersionNumber ?? ""),
				platform: "ios",
				kind: "physical",
				state,
				model: hardware.productType,
			});
		}

		return devices.sort((a, b) => a.name.localeCompare(b.name));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

export async function listIosDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	const includeUnavailable = options.includeUnavailable ?? true;
	const [physical, simulators] = await Promise.all([
		listIosPhysicalDevices(includeUnavailable),
		listIosSimulators(includeUnavailable),
	]);
	return [...physical, ...simulators];
}

function parseAdbDevices(output: string): Array<{
	serial: string;
	state: string;
	product?: string;
	model?: string;
	device?: string;
	transportId?: string;
}> {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const results: Array<{
		serial: string;
		state: string;
		product?: string;
		model?: string;
		device?: string;
		transportId?: string;
	}> = [];

	for (const line of lines) {
		if (line.startsWith("List of devices")) continue;
		const parts = line.split(/\s+/);
		const serial = parts[0];
		const state = parts[1];
		if (!serial || !state) continue;

		const meta: Record<string, string> = {};
		for (const part of parts.slice(2)) {
			const eq = part.indexOf(":");
			if (eq <= 0) continue;
			meta[part.slice(0, eq)] = part.slice(eq + 1);
		}

		results.push({
			serial,
			state,
			product: meta.product,
			model: meta.model,
			device: meta.device,
			transportId: meta.transport_id,
		});
	}
	return results;
}

function humanizeAvdName(avdName: string): string {
	return titleCaseWords(avdName.replace(/_/g, " "));
}

function humanizeModel(model: string | undefined): string | undefined {
	if (!model) return undefined;
	return titleCaseWords(model.replace(/_/g, " "));
}

async function findAvdConfigPath(avdName: string): Promise<string | null> {
	const home = process.env.HOME ?? "";
	const roots = [join(home, ".android/avd"), join(home, "Library/Android/sdk/.android/avd")];

	for (const root of roots) {
		const direct = join(root, `${avdName}.avd`, "config.ini");
		try {
			await readFile(direct, "utf8");
			return direct;
		} catch {
			// keep looking
		}

		try {
			const glob = new Bun.Glob("*.avd/config.ini");
			for await (const match of glob.scan({ cwd: root, onlyFiles: true })) {
				const path = join(root, match);
				const text = await readFile(path, "utf8");
				const idLine = text.split("\n").find((line) => line.startsWith("AvdId="));
				const id = idLine?.slice("AvdId=".length).trim();
				if (id === avdName) return path;
			}
		} catch {
			// root missing
		}
	}
	return null;
}

async function readAvdConfig(
	avdName: string,
): Promise<{ api: string | null; deviceName: string | null }> {
	const path = await findAvdConfigPath(avdName);
	if (!path) return { api: null, deviceName: null };

	try {
		const text = await readFile(path, "utf8");
		const imageLine = text
			.split("\n")
			.find((line) => line.includes("system-images") && line.includes("android-"));
		const apiMatch = imageLine?.match(/android-([\d.]+)/);
		const deviceLine = text.split("\n").find((entry) => entry.startsWith("hw.device.name="));
		const deviceRaw = deviceLine?.slice("hw.device.name=".length).trim();
		return {
			api: apiMatch?.[1] ?? null,
			deviceName: humanizeModel(deviceRaw) ?? null,
		};
	} catch {
		return { api: null, deviceName: null };
	}
}

async function adbAvdName(adb: string, serial: string): Promise<string | null> {
	const { stdout, exitCode } = await runCommand([adb, "-s", serial, "emu", "avd", "name"]);
	if (exitCode !== 0) return null;
	const name = stdout.trim().split("\n")[0]?.trim();
	return name || null;
}

async function adbGetProp(adb: string, serial: string, prop: string): Promise<string | null> {
	const { stdout, exitCode } = await runCommand([adb, "-s", serial, "shell", "getprop", prop]);
	if (exitCode !== 0) return null;
	const value = stdout.trim();
	return value || null;
}

async function listAndroidAdbDevices(adb: string): Promise<{
	physical: Device[];
	runningEmulators: Device[];
	runningAvdNames: Set<string>;
}> {
	const { stdout, exitCode } = await runCommand([adb, "devices", "-l"]);
	if (exitCode !== 0) {
		return { physical: [], runningEmulators: [], runningAvdNames: new Set() };
	}

	const entries = parseAdbDevices(stdout);
	const physical: Device[] = [];
	const runningEmulators: Device[] = [];
	const runningAvdNames = new Set<string>();

	for (const entry of entries) {
		const isEmulator = entry.serial.startsWith("emulator-") || entry.product === "sdk_gphone";
		if (isEmulator) {
			const avdName = await adbAvdName(adb, entry.serial);
			if (avdName) runningAvdNames.add(avdName);
			const avdConfig = avdName ? await readAvdConfig(avdName) : null;
			const release =
				(await adbGetProp(adb, entry.serial, "ro.build.version.release")) ?? avdConfig?.api ?? null;
			const model =
				humanizeModel(entry.model) ??
				avdConfig?.deviceName ??
				(avdName ? humanizeAvdName(avdName) : entry.serial);

			runningEmulators.push({
				id: avdName ?? entry.serial,
				name: model,
				osVersion: formatAndroidVersion(release ?? ""),
				platform: "android",
				kind: "emulator",
				state: entry.state === "device" ? "online" : entry.state,
				model: avdName ?? entry.model,
			});
			continue;
		}

		const release = await adbGetProp(adb, entry.serial, "ro.build.version.release");
		const model =
			humanizeModel(entry.model) ??
			(await adbGetProp(adb, entry.serial, "ro.product.model")) ??
			entry.serial;

		physical.push({
			id: entry.serial,
			name: model,
			osVersion: formatAndroidVersion(release ?? ""),
			platform: "android",
			kind: "physical",
			state: entry.state,
			model: entry.model,
		});
	}

	return { physical, runningEmulators, runningAvdNames };
}

async function listAndroidAvds(
	emulatorBin: string,
	runningAvdNames: Set<string>,
	includeUnavailable: boolean,
): Promise<Device[]> {
	const { stdout, exitCode } = await runCommand([emulatorBin, "-list-avds"]);
	if (exitCode !== 0) return [];

	const names = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const devices: Device[] = [];
	for (const avdName of names) {
		const isRunning = runningAvdNames.has(avdName);
		if (!includeUnavailable && !isRunning) continue;
		if (isRunning) continue; // already represented via adb

		const { api, deviceName } = await readAvdConfig(avdName);

		devices.push({
			id: avdName,
			name: deviceName ?? humanizeAvdName(avdName),
			osVersion: formatAndroidVersion(api ?? ""),
			platform: "android",
			kind: "emulator",
			state: "offline",
			model: avdName,
		});
	}

	return devices;
}

export async function listAndroidDevices(options: ListDevicesOptions = {}): Promise<Device[]> {
	const includeUnavailable = options.includeUnavailable ?? true;
	const [adb, emulatorBin] = await Promise.all([resolveAdb(), resolveEmulator()]);

	const adbResult = adb
		? await listAndroidAdbDevices(adb)
		: { physical: [], runningEmulators: [], runningAvdNames: new Set<string>() };

	const offlineAvds =
		emulatorBin != null
			? await listAndroidAvds(emulatorBin, adbResult.runningAvdNames, includeUnavailable)
			: [];

	const physical = includeUnavailable
		? adbResult.physical
		: adbResult.physical.filter((device) => device.state === "device");

	const emulators = [...adbResult.runningEmulators, ...offlineAvds].sort((a, b) => {
		const aOnline = a.state === "online" ? 0 : 1;
		const bOnline = b.state === "online" ? 0 : 1;
		if (aOnline !== bOnline) return aOnline - bOnline;
		return a.name.localeCompare(b.name);
	});

	return [...physical, ...emulators];
}

export async function listDevices(
	platform: "ios" | "android",
	options: ListDevicesOptions = {},
): Promise<Device[]> {
	if (platform === "ios") return listIosDevices(options);
	return listAndroidDevices(options);
}
