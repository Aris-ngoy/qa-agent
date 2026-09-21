import type {
	RuntimeCheck,
	RuntimeStatus,
	SetupPlatformRequest,
	SetupPlatformResponse,
} from "@yoqa/runner-client";
import { probeDeveloperMode } from "../agent-device/developer-mode";
import { ensureHostToolPath } from "../agent-device/host-path";
import {
	ARGENT_CONSENT_REQUIRED_CODE,
	ArgentError,
	argentVersion,
	isSupportedArgentVersion,
	runArgentRaw,
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
export async function getArgentRuntimeStatus(): Promise<RuntimeStatus> {
	ensureHostToolPath();
	const nodePath = (await which("node")) ?? Bun.which("bun") ?? null;
	const npmPath = await which("npm");
	const probed = await probeArgent();
	const versionOk = probed.version != null && isSupportedArgentVersion(probed.version);
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
			detail: npmPath ?? "Not found on PATH (only needed to install Argent)",
		},
		{
			id: "argent",
			label: "Argent",
			ok: versionOk,
			required: true,
			detail: probed.version
				? `${probed.version}${probed.path ? ` (${probed.path})` : ""}`
				: "Not installed — splash prompts for consent, then: npm install -g @swmansion/argent",
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
		argentVersion: probed.version ?? undefined,
		checks,
	};
}

async function runNpmInstallGlobal(): Promise<void> {
	ensureHostToolPath();
	const npm = (await which("npm")) ?? Bun.which("npm");
	if (!npm) {
		throw new ArgentError(
			"npm not found — install Node.js 20.12+ first, then retry Argent install.",
			"TOOL_MISSING",
		);
	}
	const proc = Bun.spawn([npm, "install", "-g", "@swmansion/argent"], {
		env: process.env,
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	if (exitCode !== 0) {
		throw new ArgentError(
			`npm install -g @swmansion/argent failed (exit ${exitCode}): ${(stderr || stdout).trim().slice(0, 500) || "unknown error"}`,
			"INSTALL_FAILED",
			"Retry from a terminal with network access, or install manually and press Retry.",
		);
	}
	resetArgentProbeCache();
}

let argentServerWarming = false;

async function bestEffortServerProbe(): Promise<void> {
	if (argentServerWarming) return;
	argentServerWarming = true;
	try {
		await runArgentRaw(["server", "status"], { timeoutMs: 15_000 });
	} catch {
		try {
			await runArgentRaw(["server", "start"], { timeoutMs: 30_000 });
		} catch {
			// Informational only; readiness already passed above.
		}
	} finally {
		argentServerWarming = false;
	}
}

function resetArgentProbeCache(): void {
	// resolveArgentBin caches per process; a fresh install must re-resolve.
	// Imported lazily to avoid cycles in tests.
	void import("./cli").then((mod) => mod.resetArgentBinForTests());
}

/**
 * Ensure the Argent backend is ready. Never installs without explicit consent —
 * the splash screen prompts first and passes `{ consent: true }`.
 */
export async function ensureArgentRuntime(options: { consent?: boolean } = {}): Promise<{
	ok: true;
	ready: boolean;
	status: RuntimeStatus;
	message: string;
}> {
	if (!options.consent) {
		const status = await getArgentRuntimeStatus();
		if (status.ready) {
			await bestEffortServerProbe();
			const fresh = await getArgentRuntimeStatus();
			return {
				ok: true as const,
				ready: fresh.ready,
				status: fresh,
				message: fresh.ready ? "Argent runtime is ready" : "Argent runtime is not ready",
			};
		}
		throw new ArgentError(
			"Argent install needs your consent before Yoqa changes your machine.",
			ARGENT_CONSENT_REQUIRED_CODE,
			"Splash shows Install Argent / Not now. Accept runs: npm install -g @swmansion/argent, then argent init --global.",
		);
	}
	const before = await getArgentRuntimeStatus();
	const probe = before.checks.find((check) => check.id === "argent");
	if (!probe?.ok) {
		await runNpmInstallGlobal();
	}
	const status = await getArgentRuntimeStatus();
	if (!status.ready) {
		const failed = status.checks.filter((check) => check.required && !check.ok);
		throw new ArgentError(
			`Argent runtime not ready: ${failed.map((check) => `${check.label} — ${check.detail ?? "missing"}`).join("; ")}. Install with: npm install -g @swmansion/argent`,
			"NOT_READY",
		);
	}
	await bestEffortServerProbe();
	const fresh = await getArgentRuntimeStatus();
	return {
		ok: true as const,
		ready: fresh.ready,
		status: fresh,
		message: fresh.ready ? "Argent runtime is ready" : "Argent runtime is not ready",
	};
}

/** Platform setup is a verify under Argent (no per-platform drivers). */
export async function setupArgentPlatform(
	request: SetupPlatformRequest | "ios" | "android",
): Promise<SetupPlatformResponse> {
	const params: SetupPlatformRequest =
		typeof request === "string" ? { platform: request } : request;
	const status = await getArgentRuntimeStatus();
	if (!status.ready) {
		throw new ArgentError(
			`Argent runtime not ready (${status.checks
				.filter((c) => c.required && !c.ok)
				.map((c) => c.label)
				.join(", ")}). Install with: npm install -g @swmansion/argent`,
			"NOT_READY",
		);
	}
	let serverDetail: string | undefined;
	try {
		const { stdout } = await runArgentRaw(["server", "status"], { timeoutMs: 15_000 });
		serverDetail = stdout.trim().split("\n")[0]?.trim().slice(0, 200) || undefined;
	} catch (error) {
		serverDetail = (error instanceof Error ? error.message : String(error)).slice(0, 200);
	}
	return {
		ok: true as const,
		platform: params.platform,
		argentVersion: status.argentVersion ?? "unknown",
		alreadyInstalled: true,
		message: serverDetail
			? `Argent ${params.platform} ready (${status.argentVersion ?? "unknown"}). ${serverDetail}`
			: `Argent ${params.platform} ready (${status.argentVersion ?? "unknown"})`,
	};
}
