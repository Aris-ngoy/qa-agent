import type {
	RuntimeCheck,
	RuntimeStatus,
	SetupPlatformRequest,
	SetupPlatformResponse,
} from "@yoqa/runner-client";
import { agentDeviceVersion, isSupportedAgentDeviceVersion, runAgentDevice } from "./cli";
import { probeDeveloperMode } from "./developer-mode";
import { ensureHostToolPath } from "./host-path";

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

async function probeAgentDevice(): Promise<{ version: string | null; path: string | null }> {
	const path = await which("agent-device");
	const version = await agentDeviceVersion();
	if (version) return { version, path };
	// Fall back to the workspace-local binary resolved without PATH.
	try {
		const { resolveAgentDeviceBin } = await import("./cli");
		const bin = await resolveAgentDeviceBin();
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

/** Read-only readiness snapshot (installs nothing). */
export async function getAgentDeviceRuntimeStatus(): Promise<RuntimeStatus> {
	ensureHostToolPath();
	const nodePath = (await which("node")) ?? Bun.which("bun") ?? null;
	const npmPath = await which("npm");
	const probed = await probeAgentDevice();
	const versionOk = probed.version != null && isSupportedAgentDeviceVersion(probed.version);
	const host = await probeHostTools();
	const developerMode = await probeDeveloperMode();

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
			detail: npmPath ?? "Not found on PATH (only needed to install agent-device)",
		},
		{
			id: "agent-device",
			label: "agent-device",
			ok: versionOk,
			required: true,
			detail: probed.version
				? `${probed.version}${probed.path ? ` (${probed.path})` : ""}`
				: "Not installed — run: npm install -g agent-device@latest",
		},
		host.xcode,
		host.adb,
		{
			id: "developer-mode",
			label: "Developer Mode",
			ok: developerMode.status === "pass",
			required: false,
			detail: developerMode.detail,
		},
	];

	return {
		ready: checks.filter((check) => check.required).every((check) => check.ok),
		agentDeviceVersion: probed.version ?? undefined,
		checks,
	};
}

type DoctorCheck = {
	id?: string;
	status?: string;
	summary?: string;
	hint?: string;
};

/**
 * Ensure the agent-device backend is ready. agent-device self-manages its iOS
 * runner/XCTest backend on first `open`, so ensure = verify + doctor probe.
 */
export async function ensureAgentDeviceRuntime(): Promise<{
	ok: true;
	ready: boolean;
	status: RuntimeStatus;
	message: string;
}> {
	const status = await getAgentDeviceRuntimeStatus();
	if (!status.ready) {
		const failed = status.checks.filter((check) => check.required && !check.ok);
		throw new Error(
			`agent-device runtime not ready: ${failed.map((check) => `${check.label} — ${check.detail ?? "missing"}`).join("; ")}. Install with: npm install -g agent-device@latest`,
		);
	}
	// Best-effort backend probe; a missing simulator here must not fail ensure
	// when the user only targets the other platform.
	try {
		await runAgentDevice(["doctor", "--remote"], { timeoutMs: 30_000 });
	} catch {
		// doctor --remote is informational; readiness already passed above.
	}
	const fresh = await getAgentDeviceRuntimeStatus();
	return {
		ok: true as const,
		ready: fresh.ready,
		status: fresh,
		message: fresh.ready ? "agent-device runtime is ready" : "agent-device runtime is not ready",
	};
}

/** Platform setup is a no-op verify under agent-device (no per-platform drivers). */
export async function setupAgentDevicePlatform(
	request: SetupPlatformRequest | "ios" | "android",
): Promise<SetupPlatformResponse> {
	const params: SetupPlatformRequest =
		typeof request === "string" ? { platform: request } : request;
	const status = await getAgentDeviceRuntimeStatus();
	if (!status.ready) {
		throw new Error(
			`agent-device runtime not ready (${status.checks
				.filter((c) => c.required && !c.ok)
				.map((c) => c.label)
				.join(", ")}). Install with: npm install -g agent-device@latest`,
		);
	}
	let doctorDetail: string | undefined;
	try {
		const data = (await runAgentDevice(["doctor", "--platform", params.platform], {
			timeoutMs: 60_000,
		})) as { checks?: DoctorCheck[]; summary?: string };
		const fails = (data.checks ?? []).filter((c) => c.status === "fail");
		if (fails.length > 0) {
			throw new Error(fails.map((c) => `${c.id ?? "check"}: ${c.summary ?? "failed"}`).join("; "));
		}
		doctorDetail = data.summary;
	} catch (error) {
		// A doctor failure for the *other* platform's missing toolchain (e.g. no
		// adb when setting up ios) must not block setup — readiness passed.
		const message = error instanceof Error ? error.message : String(error);
		if (/adb|hdc|vega|harmonyos/i.test(message) && params.platform === "ios") {
			doctorDetail = undefined;
		} else if (/xcode|simulator|xcuitest/i.test(message) && params.platform === "android") {
			doctorDetail = undefined;
		} else if (params.platform === "ios" || params.platform === "android") {
			// Keep setup green when only optional tooling is missing; surface it.
			doctorDetail = message.slice(0, 200);
		} else {
			throw error;
		}
	}
	return {
		ok: true as const,
		platform: params.platform,
		agentDeviceVersion: status.agentDeviceVersion ?? "unknown",
		alreadyInstalled: true,
		message: doctorDetail
			? `agent-device ${params.platform} ready (${status.agentDeviceVersion ?? "unknown"}). ${doctorDetail}`
			: `agent-device ${params.platform} ready (${status.agentDeviceVersion ?? "unknown"})`,
	};
}
