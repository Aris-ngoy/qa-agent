import type { Device } from "@yoqa/runner-client";

/**
 * Physical iPhones (and iPads) from `xcrun devicectl list devices --json-output`.
 * Only a phone on a cable with a connected tunnel is a target; anything else is
 * listed with an `unavailableReason` the user can act on (a Wi-Fi-paired phone
 * would be picked and then fail).
 */

type LegacyDevice = {
	hardwareProperties?: {
		udid?: string;
		marketingName?: string;
		deviceType?: string;
		productType?: string;
		platform?: string;
		reality?: string;
	};
	deviceProperties?: {
		name?: string;
		osVersionNumber?: string;
		developerModeStatus?: string;
	};
	connectionProperties?: {
		tunnelState?: string;
		pairingState?: string;
		transportType?: string;
	};
};

/** The `properties` dictionary that replaces the fields above in newer Xcode. */
type DevicectlProperties = {
	hardware?: LegacyDevice["hardwareProperties"];
	connection?: { state?: string; pairingState?: string; transportType?: string };
	software?: { osVersionNumber?: { stringValue?: string } };
	state?: { name?: string; developerModeStatus?: Record<string, unknown> };
};

type DevicectlDevice = LegacyDevice & { properties?: DevicectlProperties };

type Reading = {
	udid?: string;
	marketingName?: string;
	deviceType?: string;
	productType?: string;
	platform?: string;
	reality?: string;
	owner?: string;
	osVersion?: string;
	developerMode?: "enabled" | "disabled";
	tunnel: string;
	pairing?: string;
	transport?: string;
};

function developerMode(value: unknown): Reading["developerMode"] {
	const key =
		typeof value === "string"
			? value
			: value && typeof value === "object"
				? Object.keys(value)[0]
				: undefined;
	return key === "enabled" || key === "disabled" ? key : undefined;
}

function read(item: DevicectlDevice): Reading {
	const props = item.properties;
	const hardware = props?.hardware ?? item.hardwareProperties;
	const legacyConnection = item.connectionProperties;
	return {
		...hardware,
		owner: (props?.state?.name ?? item.deviceProperties?.name)?.trim() || undefined,
		osVersion:
			props?.software?.osVersionNumber?.stringValue ?? item.deviceProperties?.osVersionNumber,
		developerMode: developerMode(
			props?.state?.developerModeStatus ?? item.deviceProperties?.developerModeStatus,
		),
		tunnel: (props?.connection?.state ?? legacyConnection?.tunnelState ?? "").toLowerCase(),
		pairing: props?.connection?.pairingState ?? legacyConnection?.pairingState,
		transport: props?.connection?.transportType ?? legacyConnection?.transportType,
	};
}

function formatIosVersion(version: string | undefined): string {
	const trimmed = version?.trim() ?? "";
	if (!trimmed) return "iOS";
	return /^iOS\b/i.test(trimmed) ? trimmed : `iOS ${trimmed}`;
}

/** The state shown for the phone, and why it is not a target (undefined when it is). */
function targetState(reading: Reading): { state: string; unavailableReason?: string } {
	if (reading.transport !== "wired") {
		return {
			state: reading.pairing === "paired" ? "paired" : reading.tunnel || "unavailable",
			unavailableReason:
				"Paired over Wi-Fi only. Connect the iPhone to this Mac with a cable, then refresh.",
		};
	}
	if (reading.tunnel !== "connected") {
		return {
			state: reading.tunnel || "disconnected",
			unavailableReason:
				"On a cable but not connected. Unlock the iPhone and trust this Mac, then refresh.",
		};
	}
	if (reading.developerMode === "disabled") {
		return {
			state: "connected",
			unavailableReason:
				"Developer Mode is off. Turn it on in Settings › Privacy & Security › Developer Mode, then refresh.",
		};
	}
	return { state: "connected" };
}

/**
 * Cabled, paired phones whose tunnel is down. CoreDevice opens the tunnel on first
 * use, so `list devices` reports these as `disconnected` until something touches
 * them; they are not a failure yet.
 */
export function idleWiredUdids(json: unknown): string[] {
	const items = (json as { result?: { devices?: unknown } } | null)?.result?.devices;
	if (!Array.isArray(items)) return [];
	const udids: string[] = [];
	for (const item of items as DevicectlDevice[]) {
		const reading = read(item);
		if (!reading.udid || (reading.reality && reading.reality !== "physical")) continue;
		if (!/^(iPhone|iPad)$/i.test(reading.deviceType ?? "")) continue;
		if (
			reading.transport === "wired" &&
			reading.pairing === "paired" &&
			reading.tunnel !== "connected"
		) {
			udids.push(reading.udid);
		}
	}
	return udids;
}

export function parseDevicectlDevices(json: unknown): Device[] {
	const items = (json as { result?: { devices?: unknown } } | null)?.result?.devices;
	if (!Array.isArray(items)) return [];

	const devices: Device[] = [];
	for (const item of items as DevicectlDevice[]) {
		const reading = read(item);
		if (!reading.udid) continue;
		if (reading.reality && reading.reality !== "physical") continue;
		if (!/^(iPhone|iPad)$/i.test(reading.deviceType ?? "")) continue;
		if (reading.platform && !/^iOS$/i.test(reading.platform)) continue;

		const { state, unavailableReason } = targetState(reading);
		devices.push({
			id: reading.udid,
			name: reading.marketingName ?? reading.productType ?? "iPhone",
			owner: reading.owner,
			osVersion: formatIosVersion(reading.osVersion),
			platform: "ios",
			kind: "physical",
			state,
			model: reading.productType,
			...(unavailableReason ? { unavailableReason } : {}),
		});
	}
	return devices.sort((a, b) => a.name.localeCompare(b.name));
}

type DevicectlApp = {
	bundleIdentifier?: string;
	url?: string;
	builtByDeveloper?: boolean;
	hidden?: boolean;
	appClip?: boolean;
};

/** `YoqaRunner`'s own test host, which is installed on the phone but never the app under test. */
const YOQA_RUNNER_BUNDLE_PREFIX = "dev.yoqa.runner.";

/**
 * The user apps from `xcrun devicectl device info apps --json-output`, as bundle ids: the
 * ones a developer built first, since the app under test is usually one of them. Hidden
 * apps, app clips and `YoqaRunner` itself are left out.
 */
export function parseDevicectlApps(json: unknown): string[] {
	const items = (json as { result?: { apps?: unknown } } | null)?.result?.apps;
	if (!Array.isArray(items)) return [];
	const apps = (items as DevicectlApp[]).filter(
		(app): app is DevicectlApp & { bundleIdentifier: string } =>
			typeof app.bundleIdentifier === "string" &&
			!app.hidden &&
			!app.appClip &&
			!app.bundleIdentifier.startsWith(YOQA_RUNNER_BUNDLE_PREFIX),
	);
	const developerBuilt = apps.filter((app) => app.builtByDeveloper);
	const others = apps.filter((app) => !app.builtByDeveloper);
	return [...developerBuilt, ...others].map((app) => app.bundleIdentifier);
}

/**
 * Where an app is installed, from `xcrun devicectl device info apps --json-output`: the
 * `file://` url of its bundle on the phone. Undefined when the app is not listed.
 */
export function parseDevicectlAppUrl(json: unknown, bundleId: string): string | undefined {
	const items = (json as { result?: { apps?: unknown } } | null)?.result?.apps;
	if (!Array.isArray(items)) return undefined;
	const app = (items as DevicectlApp[]).find((item) => item.bundleIdentifier === bundleId);
	return typeof app?.url === "string" && app.url ? app.url : undefined;
}

export type DevicectlProcess = { pid: number; executable: string };

/**
 * The running processes from `xcrun devicectl device info processes --json-output`. Null
 * when the output is unreadable, so a listing that failed is never read as "nothing runs".
 */
export function parseDevicectlProcesses(json: unknown): DevicectlProcess[] | null {
	const items = (json as { result?: { runningProcesses?: unknown } } | null)?.result
		?.runningProcesses;
	if (!Array.isArray(items)) return null;
	const processes: DevicectlProcess[] = [];
	for (const item of items as Array<{ executable?: unknown; processIdentifier?: unknown }>) {
		if (typeof item?.processIdentifier !== "number" || typeof item.executable !== "string")
			continue;
		processes.push({ pid: item.processIdentifier, executable: item.executable });
	}
	return processes;
}

/** A `file://` url as devicectl prints it, percent-escapes undone. */
function decoded(url: string): string {
	try {
		return decodeURI(url);
	} catch {
		return url;
	}
}

/**
 * The app's own process: the executable directly inside its bundle (`appUrl`, from
 * `parseDevicectlAppUrl`). Its extensions run from `PlugIns/` and `Extensions/` deeper in
 * the bundle and are not the app.
 */
export function appMainProcess(
	processes: DevicectlProcess[],
	appUrl: string,
): DevicectlProcess | undefined {
	const bundle = decoded(appUrl.endsWith("/") ? appUrl : `${appUrl}/`);
	return processes.find((process) => {
		const executable = decoded(process.executable);
		if (!executable.startsWith(bundle)) return false;
		const inside = executable.slice(bundle.length);
		return inside !== "" && !inside.includes("/");
	});
}
