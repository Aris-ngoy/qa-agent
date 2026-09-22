import type {
	RuntimeCheck,
	RuntimeStatus,
	SetupPlatformRequest,
	SetupPlatformResponse,
} from "@yoqa/runner-client";
import {
	ARGENT_INSTALL_HINT,
	ARGENT_TELEMETRY_HINT,
	argentServerStatus,
	argentVersion,
	isSupportedArgentVersion,
} from "./cli";

async function which(bin: string): Promise<string | null> {
	try {
		const proc = Bun.spawn(["which", bin], { stdout: "pipe", stderr: "pipe" });
		const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		if (exitCode !== 0) return null;
		const path = stdout.trim().split("\n")[0]?.trim();
		return path || null;
	} catch {
		return null;
	}
}

async function probeArgent(): Promise<{ version: string | null; path: string | null }> {
	const path = await which("argent");
	const version = await argentVersion();
	if (version) return { version, path };
	// Fall back to the workspace-local binary resolved without PATH.
	try {
		const { resolveArgentBin } = await import("./cli");
		const bin = await resolveArgentBin();
		const direct = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
		const [stdout, exitCode] = await Promise.all([
			new Response(direct.stdout).text(),
			direct.exited,
		]);
		if (exitCode === 0) {
			const fallback = stdout.trim().split("\n")[0]?.trim() || null;
			return { version: fallback, path: bin };
		}
	} catch {
		// ignore
	}
	return { version: null, path };
}

async function probeServer(): Promise<string> {
	try {
		const status = await argentServerStatus();
		if (status.running) {
			return `tool-server running${status.port ? ` (port ${status.port})` : ""}`;
		}
		return "tool-server stopped — run `argent server start`";
	} catch {
		return "tool-server unreachable — run `argent server start`";
	}
}

async function probeHostTools(): Promise<{ xcode: RuntimeCheck; adb: RuntimeCheck }> {
	const xcodePath = await which("xcodebuild");
	let adbPath = await which("adb");
	if (!adbPath) {
		const home = process.env.HOME ?? "";
		const sdkAdb = `${home}/Library/Android/sdk/platform-tools/adb`;
		try {
			if (await Bun.file(sdkAdb).exists()) adbPath = sdkAdb;
		} catch {
			// ignore
		}
	}
	return {
		xcode: {
			id: "xcode",
			label: "Xcode",
			ok: Boolean(xcodePath),
			required: false,
			detail: xcodePath ?? "Not found — needed for iOS simulators",
		},
		adb: {
			id: "adb",
			label: "Android Debug Bridge",
			ok: Boolean(adbPath),
			required: false,
			detail: adbPath ?? "Not found — needed for Android devices",
		},
	};
}

/**
 * Read-only readiness snapshot (installs nothing). The backend check carries
 * the first-class `argent` id; the version field keeps its
 * `agentDeviceVersion` name so the yoqa CLI/HTTP contract stays stable.
 */
export async function getArgentRuntimeStatus(): Promise<RuntimeStatus> {
	const nodePath = (await which("node")) ?? Bun.which("bun") ?? null;
	const npmPath = await which("npm");
	const probed = await probeArgent();
	const versionOk = probed.version != null && isSupportedArgentVersion(probed.version);
	const host = await probeHostTools();
	const server = versionOk ? await probeServer() : "tool-server not probed (Argent missing)";

	const checks: RuntimeCheck[] = [
		{
			id: "node",
			label: "Node.js",
			ok: Boolean(nodePath),
			required: true,
			detail: nodePath ?? "Not found on PATH",
		},
		{
			id: "npm",
			label: "npm",
			ok: Boolean(npmPath),
			required: false,
			detail: npmPath ?? "Not found on PATH (only needed to install Argent)",
		},
		{
			id: "argent",
			label: "Argent",
			ok: versionOk,
			required: true,
			detail: probed.version
				? `${probed.version}${probed.path ? ` (${probed.path})` : ""}; ${server}`
				: `Not installed — ${ARGENT_INSTALL_HINT} ${ARGENT_TELEMETRY_HINT}`,
		},
		host.xcode,
		host.adb,
	];

	return {
		ready: checks.filter((check) => check.required).every((check) => check.ok),
		agentDeviceVersion: probed.version ?? undefined,
		checks,
	};
}

/** Platform setup is a verify under Argent (no per-platform drivers to install). */
export async function setupArgentPlatform(
	request: SetupPlatformRequest | "ios" | "android",
): Promise<SetupPlatformResponse> {
	const params: SetupPlatformRequest =
		typeof request === "string" ? { platform: request } : request;
	const status = await getArgentRuntimeStatus();
	if (!status.ready) {
		throw new Error(
			`Argent runtime not ready (${status.checks
				.filter((c) => c.required && !c.ok)
				.map((c) => c.label)
				.join(", ")}). ${ARGENT_INSTALL_HINT} ${ARGENT_TELEMETRY_HINT}`,
		);
	}
	// Best-effort backend probe; an unreachable tool-server here must not fail
	// setup when the caller only needs the version gate (per-device
	// reachability is owned by list-devices at connect).
	let detail: string | undefined;
	try {
		await argentServerStatus();
	} catch (error) {
		detail = error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200);
	}
	return {
		ok: true as const,
		platform: params.platform,
		agentDeviceVersion: status.agentDeviceVersion ?? "unknown",
		alreadyInstalled: true,
		message: detail
			? `Argent ${params.platform} ready (${status.agentDeviceVersion ?? "unknown"}). ${detail}`
			: `Argent ${params.platform} ready (${status.agentDeviceVersion ?? "unknown"})`,
	};
}

/**
 * Ensure the Argent backend is ready. Argent self-manages its tool-server and
 * device backends, so ensure = verify + `server status` probe.
 */
export async function ensureArgentBackend(): Promise<{
	ok: true;
	ready: boolean;
	status: RuntimeStatus;
	message: string;
}> {
	const status = await getArgentRuntimeStatus();
	if (!status.ready) {
		const failed = status.checks.filter((check) => check.required && !check.ok);
		throw new Error(
			`Argent runtime not ready: ${failed.map((check) => `${check.label} — ${check.detail ?? "missing"}`).join("; ")}. ${ARGENT_INSTALL_HINT} ${ARGENT_TELEMETRY_HINT}`,
		);
	}
	// Best-effort backend probe; an unreachable server here must not fail
	// ensure when the caller only needs the version gate (ticket 2 owns
	// per-device reachability via list-devices).
	try {
		await argentServerStatus();
	} catch {
		// server status is informational; readiness already passed above.
	}
	const fresh = await getArgentRuntimeStatus();
	return {
		ok: true as const,
		ready: fresh.ready,
		status: fresh,
		message: fresh.ready ? "Argent runtime is ready" : "Argent runtime is not ready",
	};
}
