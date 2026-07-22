#!/usr/bin/env bun
import { createRunnerClient } from "@yoqa/runner-client";
import { Command } from "commander";
import { runnerBaseUrl } from "../../settings";

const program = new Command();

program
	.name("yoqa")
	.description("Local YoQA CLI (talks to the Bun runner over HTTP)")
	.version("0.1.0");

program
	.command("health")
	.description("Check that the local runner is reachable")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (options: { baseUrl: string }) => {
		const client = createRunnerClient({ baseUrl: options.baseUrl });
		try {
			const health = await client.health();
			console.log(JSON.stringify(health, null, 2));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`yoqa health failed: ${message}`);
			console.error("Is the runner up? Try: bun run runner");
			process.exitCode = 1;
		}
	});

const devices = program
	.command("devices")
	.description("List local devices, simulators, and emulators");

function printDevicesTable(
	devicesList: Array<{
		id: string;
		name: string;
		owner?: string;
		osVersion: string;
		kind: string;
		state?: string;
	}>,
) {
	if (devicesList.length === 0) {
		console.log("No devices found.");
		return;
	}

	for (const device of devicesList) {
		const label = device.owner ? `${device.name} (${device.owner})` : device.name;
		const state = device.state ? ` [${device.state}]` : "";
		console.log(`${device.kind.padEnd(10)} ${label} — ${device.osVersion}${state}`);
		console.log(`           ${device.id}`);
	}
}

for (const platform of ["ios", "android"] as const) {
	devices
		.command(platform)
		.description(
			`List ${platform === "ios" ? "iOS devices and simulators" : "Android devices and emulators"}`,
		)
		.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
		.option("--json", "Print raw JSON")
		.option("--booted-only", "Only show booted / online devices")
		.action(async (options: { baseUrl: string; json?: boolean; bootedOnly?: boolean }) => {
			const client = createRunnerClient({ baseUrl: options.baseUrl });
			try {
				const body = await client.listDevices(platform, {
					includeUnavailable: !options.bootedOnly,
				});
				if (options.json) {
					console.log(JSON.stringify(body, null, 2));
					return;
				}
				printDevicesTable(body.devices);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`yoqa devices ${platform} failed: ${message}`);
				console.error("Is the runner up? Try: bun run runner");
				process.exitCode = 1;
			}
		});
}

const setup = program
	.command("setup")
	.description("Install Appium and the platform driver (xcuitest / uiautomator2)");

setup
	.command("ios")
	.description("Ensure Appium + xcuitest; optionally build and install WDA on a physical device")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--device <udid>", "Physical device UDID to install WebDriverAgent on")
	.option("--kind <kind>", "Device kind: physical | simulator", "physical")
	.option("--xcode <path>", "Xcode Contents/Developer path (DEVELOPER_DIR)")
	.option("--team <teamId>", "Apple Development team ID")
	.option("--identity <name>", 'Codesigning identity name, e.g. "Apple Development: …"')
	.action(
		async (options: {
			baseUrl: string;
			json?: boolean;
			device?: string;
			kind?: string;
			xcode?: string;
			team?: string;
			identity?: string;
		}) => {
			const client = createRunnerClient({ baseUrl: options.baseUrl });
			try {
				const kind =
					options.kind === "simulator" || options.kind === "physical" ? options.kind : undefined;
				const body = await client.setupPlatform({
					platform: "ios",
					deviceId: options.device,
					kind,
					xcodeDeveloperDir: options.xcode,
					developmentTeam: options.team,
					codeSignIdentity: options.identity,
				});
				if (options.json) {
					console.log(JSON.stringify(body, null, 2));
					return;
				}
				console.log(body.message);
				console.log(`driver: ${body.driver}${body.driverVersion ? ` ${body.driverVersion}` : ""}`);
				console.log(`appium: ${body.appiumVersion}`);
				if (body.wdaInstalled) {
					console.log(`wda: installed (${body.wdaBundleId ?? "unknown bundle"})`);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`yoqa setup ios failed: ${message}`);
				console.error("Is the runner up? Try: bun run runner");
				process.exitCode = 1;
			}
		},
	);

setup
	.command("android")
	.description("Ensure Appium + uiautomator2 driver are installed")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		const client = createRunnerClient({ baseUrl: options.baseUrl });
		try {
			const body = await client.setupPlatform("android");
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.message);
			console.log(`driver: ${body.driver}${body.driverVersion ? ` ${body.driverVersion}` : ""}`);
			console.log(`appium: ${body.appiumVersion}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`yoqa setup android failed: ${message}`);
			console.error("Is the runner up? Try: bun run runner");
			process.exitCode = 1;
		}
	});

const runtime = program
	.command("runtime")
	.description("Check or ensure the local Appium runtime (drivers + host tools)");

runtime
	.command("status")
	.description("Show readiness of Appium, drivers, and host tools")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		const client = createRunnerClient({ baseUrl: options.baseUrl });
		try {
			const body = await client.getRuntimeStatus();
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.ready ? "ready" : "not ready");
			for (const check of body.checks) {
				const mark = check.ok ? "ok" : check.required ? "FAIL" : "warn";
				console.log(`  [${mark}] ${check.label}${check.detail ? ` — ${check.detail}` : ""}`);
			}
			if (!body.ready) process.exitCode = 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`yoqa runtime status failed: ${message}`);
			console.error("Is the runner up? Try: bun run runner");
			process.exitCode = 1;
		}
	});

runtime
	.command("ensure")
	.description("Install Appium + both platform drivers if missing")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		const client = createRunnerClient({ baseUrl: options.baseUrl });
		try {
			const body = await client.ensureRuntime();
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.message);
			for (const check of body.status.checks) {
				const mark = check.ok ? "ok" : check.required ? "FAIL" : "warn";
				console.log(`  [${mark}] ${check.label}${check.detail ? ` — ${check.detail}` : ""}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`yoqa runtime ensure failed: ${message}`);
			console.error("Is the runner up? Try: bun run runner");
			process.exitCode = 1;
		}
	});

await program.parseAsync(process.argv);
