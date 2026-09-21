import { join } from "node:path";
import type {
	DoctorCheck,
	DoctorRepairId,
	DoctorRepairResponse,
	DoctorReport,
	DoctorStep,
} from "@yoqa/runner-client";
import { loadSettings } from "../../settings";
import { runAgentDevice } from "../agent-device/cli";
import { enableDeveloperMode } from "../agent-device/developer-mode";
import { ensureHostToolPath } from "../agent-device/host-path";
import { getAgentDeviceRuntimeStatus } from "../agent-device/runtime";
import { runArgentRaw } from "../argent/cli";
import { getArgentRuntimeStatus } from "../argent/runtime";
import { disconnectDevice, getActiveSessionInfo } from "../devices/active-session";
import { listServers } from "../servers/application";

async function runCommand(
	command: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	ensureHostToolPath();
	try {
		const proc = Bun.spawn(command, {
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

async function which(bin: string): Promise<string | null> {
	const { stdout, exitCode } = await runCommand(["which", bin]);
	if (exitCode !== 0) return null;
	const path = stdout.trim().split("\n")[0]?.trim();
	return path || null;
}

async function probeJava(): Promise<DoctorCheck> {
	const javaHome = process.env.JAVA_HOME;
	const javaBin = (await which("java")) ?? null;
	const studioJbr = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
	let detail = javaBin ?? "java not on PATH";
	if (javaHome) detail = `JAVA_HOME=${javaHome}`;
	else if (await Bun.file(join(studioJbr, "bin/java")).exists()) {
		detail = `Android Studio JBR available at ${studioJbr} (JAVA_HOME unset)`;
	}

	const ok = Boolean(javaBin || javaHome);
	return {
		id: "java",
		label: "Java",
		status: ok ? "pass" : "warn",
		detail,
		fixHint: ok ? undefined : "Install a JDK or set JAVA_HOME (Android Studio JBR works)",
	};
}

async function probeXcodeSelect(): Promise<DoctorCheck> {
	const { stdout, exitCode } = await runCommand(["xcode-select", "-p"]);
	if (exitCode !== 0) {
		return {
			id: "xcode-select",
			label: "Xcode command-line tools",
			status: "warn",
			detail: "xcode-select path not configured",
			fixHint: "Run: xcode-select --install (or select an Xcode.app)",
		};
	}
	return {
		id: "xcode-select",
		label: "Xcode command-line tools",
		status: "pass",
		detail: stdout.trim(),
	};
}

async function probeSessionHealth(): Promise<DoctorCheck> {
	const active = getActiveSessionInfo();
	if (!active) {
		return {
			id: "device-session",
			label: "Active device session",
			status: "pass",
			detail: "No active session",
		};
	}
	return {
		id: "device-session",
		label: "Active device session",
		status: active.heldByRun ? "warn" : "pass",
		detail: `${active.platform} ${active.deviceId}${active.heldByRun ? " (in use by a run)" : ""}`,
		fixHint: active.heldByRun ? "Cancel the run before disconnecting" : undefined,
	};
}

async function probeArgentServer(): Promise<DoctorCheck[]> {
	try {
		const { stdout } = await runArgentRaw(["server", "status"], { timeoutMs: 15_000 });
		const detail = stdout.trim().split("\n")[0]?.trim().slice(0, 240) || "Argent server running";
		return [
			{
				id: "argent-server",
				label: "Argent server",
				status: "pass",
				detail,
			},
		];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return [
			{
				id: "argent-server",
				label: "Argent server",
				status: "warn",
				detail: message.slice(0, 240),
				fixHint: "Run: argent server start",
			},
		];
	}
}

async function probeAgentDeviceDoctor(): Promise<DoctorCheck[]> {
	try {
		const data = (await runAgentDevice(["doctor", "--remote"], { timeoutMs: 30_000 })) as {
			checks?: Array<{ id?: string; status?: string; summary?: string; hint?: string }>;
			summary?: string;
		};
		const checks = Array.isArray(data.checks) ? data.checks : [];
		// Yoqa is local-first: `doctor --remote` is used as a light probe that
		// skips local device inventory. `remote-connection` fail ("no remote
		// daemon configured") and `session` info are expected, not health
		// signals, so drop them instead of surfacing them in Diagnostics.
		return checks
			.filter((check) => check.id !== "remote-connection" && check.status !== "info")
			.slice(0, 12)
			.map((check) => {
				const rawStatus = check.status;
				return {
					id: `agent-device-${check.id ?? "check"}`,
					label: `agent-device: ${check.id ?? "check"}`,
					status:
						rawStatus === "fail"
							? ("fail" as const)
							: rawStatus === "warn"
								? ("warn" as const)
								: ("pass" as const),
					detail: check.summary,
					fixHint: check.hint,
				};
			});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return [
			{
				id: "agent-device-doctor",
				label: "agent-device doctor",
				status: "warn",
				detail: message.slice(0, 240),
				fixHint: "Run: agent-device doctor",
			},
		];
	}
}

export async function getDoctorReport(): Promise<DoctorReport> {
	ensureHostToolPath();
	const settings = loadSettings();
	const runtime = await getArgentRuntimeStatus();
	const legacy = await getAgentDeviceRuntimeStatus().catch(() => null);
	const servers = await listServers();
	const checks: DoctorCheck[] = [];

	checks.push({
		id: "runner",
		label: "yoqa-runner",
		status: "pass",
		detail: `v${settings.version} on :${settings.port} (pid ${process.pid})`,
	});

	for (const check of runtime.checks) {
		checks.push({
			id: check.id,
			label: check.label,
			status: check.ok ? "pass" : check.required ? "fail" : "warn",
			detail: check.detail,
			fixHint: check.ok
				? undefined
				: check.required
					? "Run: yoqa runtime ensure (or Repair in Diagnostics)"
					: check.id === "developer-mode"
						? "Run: yoqa doctor --fix (prompts for your password to enable Developer Mode)"
						: undefined,
		});
	}

	checks.push(await probeJava());
	checks.push(await probeXcodeSelect());
	checks.push(await probeSessionHealth());
	checks.push(...(await probeArgentServer()));
	if (legacy && !legacy.ready) {
		checks.push({
			id: "agent-device-legacy",
			label: "agent-device (legacy fallback)",
			status: "warn",
			detail: "Legacy backend not ready — Argent is primary during migration",
		});
	}
	checks.push(...(await probeAgentDeviceDoctor()));

	const steps: DoctorStep[] = [];
	for (const check of checks) {
		if (check.status === "fail") {
			steps.push({
				severity: "error",
				title: check.label,
				detail: check.fixHint ?? check.detail ?? "Fix this check",
				repair:
					check.id === "node" ||
					check.id === "argent" ||
					check.id === "agent-device" ||
					check.id === "argent-server" ||
					check.id === "agent-device-doctor"
						? "ensure-runtime"
						: undefined,
			});
		} else if (check.status === "warn" && check.fixHint) {
			steps.push({
				severity: "warn",
				title: check.label,
				detail: check.fixHint,
				repair:
					check.id === "device-session"
						? "disconnect-session"
						: check.id === "developer-mode"
							? "enable-developer-tools"
							: undefined,
			});
		}
	}

	const ok = checks.every((check) => check.status !== "fail");
	return {
		ok,
		checks,
		servers: servers.servers,
		steps,
	};
}

export async function repairDoctor(repairs: DoctorRepairId[]): Promise<DoctorRepairResponse> {
	const unique = [...new Set(repairs)];
	const parts: string[] = [];

	for (const repair of unique) {
		if (repair === "ensure-runtime") {
			// doctor --fix is explicit user consent for the global install.
			const { ensureArgentRuntime } = await import("../argent/runtime");
			const result = await ensureArgentRuntime({ consent: true });
			parts.push(result.message);
		} else if (repair === "disconnect-session") {
			const info = await disconnectDevice();
			parts.push(
				info ? `Disconnected ${info.platform} ${info.deviceId}` : "No active device session",
			);
		} else if (repair === "enable-developer-tools") {
			parts.push(await enableDeveloperMode());
		}
	}

	const report = await getDoctorReport();
	return {
		ok: true,
		message: parts.join("; ") || "No repairs applied",
		report,
	};
}
