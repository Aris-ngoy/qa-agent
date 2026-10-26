import { join } from "node:path";
import type {
	DoctorCheck,
	DoctorRepairId,
	DoctorRepairResponse,
	DoctorReport,
	DoctorStep,
	StreamState,
} from "@yoqa/runner-client";
import { loadSettings } from "../../settings";
import { androidSdkToolPath, resolveAndroidSdkRoot } from "../android-toolchain/android-sdk";
import { ensureHostToolPath } from "../android-toolchain/host-path";
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

/** In-process PATH lookup — no POSIX `which` binary needed (absent on Windows). */
async function which(bin: string): Promise<string | null> {
	ensureHostToolPath();
	return Bun.which(bin);
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
	const sdk = resolveAndroidSdkRoot();
	const adb =
		(await which("adb")) ?? (sdk ? androidSdkToolPath(sdk, "platform-tools", "adb") : null);
	if (!adb || !(await Bun.file(adb).exists())) {
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

const STREAM_DETAIL: Record<StreamState, string> = {
	ready: "",
	none: " (screenshot poll)",
	failed: " (stream not ready)",
};

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
		// Only a stream that should be there and is not is worth a warning.
		status: active.streamState === "failed" ? "warn" : "pass",
		detail: `${active.platform} ${active.deviceId}${STREAM_DETAIL[active.streamState]}`,
		fixHint:
			active.streamState === "failed"
				? "Disconnect and reconnect the device session if the inspector stream is stuck"
				: undefined,
	};
}

export async function getDoctorReport(): Promise<DoctorReport> {
	ensureHostToolPath();
	const settings = loadSettings();
	const servers = await listServers();
	const checks: DoctorCheck[] = [];

	checks.push({
		id: "runner",
		label: "yoqa-runner",
		status: "pass",
		detail: `v${settings.version} on :${settings.port} (pid ${process.pid})`,
	});

	checks.push(await probeJava());
	checks.push(await probeXcodeSelect());
	checks.push(await probeAdbDevices());
	checks.push(await probeSessionHealth());

	const steps: DoctorStep[] = [];
	for (const check of checks) {
		if (check.status === "fail") {
			steps.push({
				severity: "error",
				title: check.label,
				detail: check.fixHint ?? check.detail ?? "Fix this check",
			});
		} else if (check.status === "warn" && check.fixHint) {
			steps.push({
				severity: "warn",
				title: check.label,
				detail: check.fixHint,
				repair: check.id === "device-session" ? "disconnect-session" : undefined,
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
		if (repair === "disconnect-session") {
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
