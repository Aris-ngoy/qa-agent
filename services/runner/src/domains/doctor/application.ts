import { homedir } from "node:os";
import { join } from "node:path";
import type {
	DoctorCheck,
	DoctorRepairId,
	DoctorRepairResponse,
	DoctorReport,
	DoctorStep,
} from "@yoqa/runner-client";
import { loadSettings } from "../../settings";
import { ensureRuntime, getRuntimeStatus, resolveAppium } from "../appium/application";
import { ensureHostToolPath } from "../appium/host-path";
import type { ResolvedAppium } from "../appium/models";
import { listForeignAppium, stopAllForeignAppium } from "../appium/server";
import { disconnectDevice, getActiveSessionInfo } from "../devices/active-session";
import { listServers } from "../servers/application";

async function runCommand(
	command: string[],
	options?: { env?: Record<string, string>; cwd?: string },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	ensureHostToolPath();
	try {
		const proc = Bun.spawn(command, {
			cwd: options?.cwd,
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

async function which(bin: string): Promise<string | null> {
	const { stdout, exitCode } = await runCommand(["which", bin]);
	if (exitCode !== 0) return null;
	const path = stdout.trim().split("\n")[0]?.trim();
	return path || null;
}

function appiumArgs(appium: ResolvedAppium, args: string[]): string[] {
	if (appium.invokeViaNode) {
		return [appium.nodeBin ?? "node", appium.bin, ...args];
	}
	return [appium.bin, ...args];
}

function parseDoctorRequiredFixes(output: string): number | null {
	const match = output.match(/(\d+)\s+required\s+fixes?\s+needed/i);
	if (!match) return null;
	return Number(match[1]);
}

async function runDriverDoctor(
	appium: ResolvedAppium,
	driver: "xcuitest" | "uiautomator2",
): Promise<DoctorCheck> {
	const { stdout, stderr, exitCode } = await runCommand(
		appiumArgs(appium, ["driver", "doctor", driver]),
		{ env: appium.env, cwd: appium.cwd },
	);
	const combined = `${stdout}\n${stderr}`;
	if (/unknown command|not support|does not support/i.test(combined)) {
		return {
			id: `doctor-${driver}`,
			label: `${driver} Appium doctor`,
			status: "warn",
			detail: "Doctor not supported for this driver build",
			fixHint: "Upgrade the driver or rely on install + smoke checks",
		};
	}

	const required = parseDoctorRequiredFixes(combined);
	if (required === null && exitCode !== 0) {
		return {
			id: `doctor-${driver}`,
			label: `${driver} Appium doctor`,
			status: "warn",
			detail: combined.trim().slice(0, 240) || `exit ${exitCode}`,
			fixHint: `Run: appium driver doctor ${driver}`,
		};
	}

	if (required !== null && required > 0) {
		return {
			id: `doctor-${driver}`,
			label: `${driver} Appium doctor`,
			status: "fail",
			detail: `${required} required fix(es) needed`,
			fixHint: `Run: appium driver doctor ${driver} and resolve required fixes`,
		};
	}

	return {
		id: `doctor-${driver}`,
		label: `${driver} Appium doctor`,
		status: "pass",
		detail: required === 0 ? "0 required fixes needed" : "Doctor completed",
	};
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

async function probeAdbDevices(): Promise<DoctorCheck> {
	const adb = (await which("adb")) ?? join(homedir(), "Library/Android/sdk/platform-tools/adb");
	if (!(await Bun.file(adb).exists()) && !(await which("adb"))) {
		return {
			id: "adb-devices",
			label: "ADB devices",
			status: "warn",
			detail: "adb not found",
			fixHint: "Install Android platform-tools",
		};
	}
	const { stdout, exitCode } = await runCommand([adb, "devices", "-l"]);
	if (exitCode !== 0) {
		return {
			id: "adb-devices",
			label: "ADB devices",
			status: "warn",
			detail: "adb devices failed",
		};
	}
	const lines = stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("List of devices"));
	const deviceLines = lines.filter((line) => !line.includes("offline"));
	return {
		id: "adb-devices",
		label: "ADB devices",
		status: "pass",
		detail:
			deviceLines.length > 0
				? `${deviceLines.length} device(s)/emulator(s) listed`
				: "No devices attached (OK if you only use iOS)",
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
		status: active.streamReady ? "pass" : "warn",
		detail: `${active.platform} ${active.deviceId}${active.streamReady ? "" : " (stream not ready)"}`,
		fixHint: active.streamReady
			? undefined
			: "Disconnect and reconnect the device session if the inspector stream is stuck",
	};
}

export async function getDoctorReport(): Promise<DoctorReport> {
	ensureHostToolPath();
	const settings = loadSettings();
	const runtime = await getRuntimeStatus();
	const servers = await listServers();
	const foreign = await listForeignAppium();
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
					: undefined,
		});
	}

	checks.push(await probeJava());
	checks.push(await probeXcodeSelect());
	checks.push(await probeAdbDevices());
	checks.push(await probeSessionHealth());

	if (foreign.length > 0) {
		checks.push({
			id: "foreign-appium",
			label: "Foreign Appium processes",
			status: "warn",
			detail: `${foreign.length} foreign listener(s) on Appium ports`,
			fixHint: "Stop foreign Appium from the Servers panel or: yoqa doctor --fix",
		});
	} else {
		checks.push({
			id: "foreign-appium",
			label: "Foreign Appium processes",
			status: "pass",
			detail: "None detected on ports 4723–4743",
		});
	}

	try {
		const appium = await resolveAppium();
		checks.push(await runDriverDoctor(appium, "xcuitest"));
		checks.push(await runDriverDoctor(appium, "uiautomator2"));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		checks.push({
			id: "doctor-drivers",
			label: "Appium driver doctor",
			status: "fail",
			detail: message,
			fixHint: "Install Appium first: yoqa runtime ensure",
		});
	}

	const steps: DoctorStep[] = [];
	for (const check of checks) {
		if (check.status === "fail") {
			steps.push({
				severity: "error",
				title: check.label,
				detail: check.fixHint ?? check.detail ?? "Fix this check",
				repair:
					check.id === "node" ||
					check.id === "npm" ||
					check.id === "appium" ||
					check.id === "xcuitest" ||
					check.id === "uiautomator2" ||
					check.id === "doctor-drivers"
						? "ensure-runtime"
						: undefined,
			});
		} else if (check.status === "warn" && check.fixHint) {
			steps.push({
				severity: "warn",
				title: check.label,
				detail: check.fixHint,
				repair:
					check.id === "foreign-appium"
						? "stop-foreign-appium"
						: check.id === "device-session"
							? "disconnect-session"
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
			const result = await ensureRuntime();
			parts.push(result.message);
		} else if (repair === "stop-foreign-appium") {
			const count = await stopAllForeignAppium();
			parts.push(
				count > 0 ? `Stopped ${count} foreign Appium process(es)` : "No foreign Appium to stop",
			);
		} else if (repair === "disconnect-session") {
			const info = await disconnectDevice();
			parts.push(
				info ? `Disconnected ${info.platform} ${info.deviceId}` : "No active device session",
			);
		}
	}

	const report = await getDoctorReport();
	return {
		ok: true,
		message: parts.join("; ") || "No repairs applied",
		report,
	};
}
