#!/usr/bin/env bun
import {
	type DevicePlatform,
	buildRunReportFromCatalogRun,
	caseScriptSchema,
	createRunnerClient,
	formatAssertShellLine,
	formatRunReportHtml,
	formatRunReportMarkdown,
	runYoqaShellScript,
	suggestedRunReportBasename,
} from "@yoqa/runner-client";
import { Command } from "commander";
import packageJson from "../../../package.json" with { type: "json" };
import { runnerBaseUrl } from "../../settings";

const program = new Command();

program
	.name("yoqa")
	.description("Local YoQA CLI (talks to the Bun runner over HTTP)")
	.version(packageJson.version);

function client(baseUrl: string) {
	return createRunnerClient({ baseUrl });
}

function fail(command: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`yoqa ${command} failed: ${message}`);
	console.error("Is the runner up? Try: bun run runner");
	process.exitCode = 1;
}

async function resolveAppId(
	c: ReturnType<typeof client>,
	prefixOrId: string,
): Promise<{ id: string; prefix: string; name: string }> {
	const apps = await c.listApps();
	const match = apps.find((a) => a.prefix === prefixOrId) ?? apps.find((a) => a.id === prefixOrId);
	if (!match) {
		throw new Error(`App not found: ${prefixOrId}. Run: yoqa apps list`);
	}
	return { id: match.id, prefix: match.prefix, name: match.name };
}

// --- health / status ---

program
	.command("health")
	.description("Check that the local runner is reachable")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (options: { baseUrl: string }) => {
		try {
			const health = await client(options.baseUrl).health();
			console.log(JSON.stringify(health, null, 2));
		} catch (error) {
			fail("health", error);
		}
	});

program
	.command("status")
	.description("Show local runner, runtime, provider, and active device status")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).getStatus();
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(
				`runner: ${body.runner.ok ? "ok" : "down"}${body.runner.version ? ` (${body.runner.version})` : ""}`,
			);
			console.log(`runtime: ${body.runtime.ready ? "ready" : "not ready"}`);
			console.log(
				`provider: ${
					body.provider.configured
						? `${body.provider.label ?? body.provider.kind ?? "configured"}`
						: "not configured"
				}`,
			);
			if (body.activeDevice) {
				console.log(`active device: ${body.activeDevice.platform} ${body.activeDevice.deviceId}`);
			} else {
				console.log("active device: none");
			}
		} catch (error) {
			fail("status", error);
		}
	});

// --- devices ---

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
		.option("--all", "Include unavailable / shutdown devices", true)
		.option("--booted-only", "Only show booted / online devices")
		.action(
			async (options: {
				baseUrl: string;
				json?: boolean;
				all?: boolean;
				bootedOnly?: boolean;
			}) => {
				try {
					const includeUnavailable = options.bootedOnly ? false : options.all !== false;
					const body = await client(options.baseUrl).listDevices(platform, {
						includeUnavailable,
					});
					if (options.json) {
						console.log(JSON.stringify(body, null, 2));
						return;
					}
					printDevicesTable(body.devices);
				} catch (error) {
					fail(`devices ${platform}`, error);
				}
			},
		);
}

devices
	.command("connect")
	.description("Open an Appium session on a device")
	.argument("<deviceId>", "Device UDID / serial")
	.requiredOption("--platform <platform>", "ios | android")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--bundle-id <id>", "iOS bundle id to launch")
	.option("--app-package <id>", "Android application id to launch")
	.option("--json", "Print raw JSON")
	.action(
		async (
			deviceId: string,
			options: {
				baseUrl: string;
				platform: string;
				bundleId?: string;
				appPackage?: string;
				json?: boolean;
			},
		) => {
			try {
				const platform = options.platform as DevicePlatform;
				if (platform !== "ios" && platform !== "android") {
					throw new Error("--platform must be ios or android");
				}
				const body = await client(options.baseUrl).connectDevice({
					deviceId,
					platform,
					bundleId: options.bundleId,
					appPackage: options.appPackage,
				});
				if (options.json) {
					console.log(JSON.stringify(body, null, 2));
					return;
				}
				console.log(`connected ${body.platform} ${body.deviceId}`);
			} catch (error) {
				fail("devices connect", error);
			}
		},
	);

devices
	.command("active")
	.description("Show the currently connected device")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).getActiveDevice();
			if (!body) {
				console.log("No active device session.");
				process.exitCode = 1;
				return;
			}
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(`${body.platform} ${body.deviceId}`);
		} catch (error) {
			fail("devices active", error);
		}
	});

devices
	.command("disconnect")
	.description("Close the active Appium session")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).disconnectDevice();
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(`disconnected ${body.platform} ${body.deviceId}`);
		} catch (error) {
			fail("devices disconnect", error);
		}
	});

// --- screen / screenshot / action ---

program
	.command("screen")
	.description("Inspect the active device screen (cleaned tree by default)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--full", "Return raw Appium page source")
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; full?: boolean; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).getScreen({ full: options.full });
			if (options.json || options.full) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			for (const el of body.elements ?? []) {
				console.log(
					`${String(el.x).padStart(4)},${String(el.y).padStart(4)}  ${el.width}x${el.height}  ${el.label}`,
				);
			}
		} catch (error) {
			fail("screen", error);
		}
	});

program
	.command("screenshot")
	.description("Capture a screenshot from the active device")
	.argument("[path]", "Output PNG path")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (path: string | undefined, options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).takeScreenshot({ path });
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.path);
		} catch (error) {
			fail("screenshot", error);
		}
	});

const action = program.command("action").description("Perform an action on the active device");

function addActionOptions(cmd: Command) {
	return cmd
		.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
		.option("--json", "Print raw JSON")
		.option("-d, --description <text>", "Ground target by natural language")
		.option("--label <text>", "Tap/focus by accessibility label (cleaned screen tree)")
		.option("--id <text>", "Tap/focus by resource-id / accessibility id")
		.option("--x <n>", "X in 0–1000", (v) => Number(v))
		.option("--y <n>", "Y in 0–1000", (v) => Number(v))
		.option("--x2 <n>", "End X in 0–1000", (v) => Number(v))
		.option("--y2 <n>", "End Y in 0–1000", (v) => Number(v))
		.option("--duration <ms>", "Gesture duration ms (long-press for tap)", (v) => Number(v))
		.option("--double", "Double-tap (tap only)")
		.option("--text <text>", "Text to type")
		.option("--app-id <id>", "Bundle id / application id")
		.option("--url <url>", "URL to open")
		.option("--seconds <n>", "Background seconds", (v) => Number(v));
}

for (const kind of [
	"tap",
	"swipe",
	"drag",
	"input",
	"activate-app",
	"terminate-app",
	"restart-app",
	"background-app",
	"open-url",
] as const) {
	addActionOptions(action.command(kind).description(`Perform ${kind}`)).action(
		async (options: Record<string, unknown>) => {
			try {
				const body = await client(String(options.baseUrl)).performAction({
					kind,
					x: options.x as number | undefined,
					y: options.y as number | undefined,
					x2: options.x2 as number | undefined,
					y2: options.y2 as number | undefined,
					durationMs: options.duration as number | undefined,
					double: options.double === true ? true : undefined,
					text: options.text as string | undefined,
					label: options.label as string | undefined,
					id: options.id as string | undefined,
					description: options.description as string | undefined,
					appId: options.appId as string | undefined,
					url: options.url as string | undefined,
					seconds: options.seconds as number | undefined,
				});
				if (options.json) {
					console.log(JSON.stringify(body, null, 2));
					return;
				}
				console.log(`ok ${body.kind}`);
				if (body.resolved?.x != null && body.resolved?.y != null) {
					console.log(`resolved ${body.resolved.x},${body.resolved.y}`);
				}
			} catch (error) {
				fail(`action ${kind}`, error);
			}
		},
	);
}

addActionOptions(
	action
		.command("alert")
		.description("Accept or dismiss a system alert")
		.option("--dismiss", "Dismiss instead of accept"),
).action(async (options: Record<string, unknown>) => {
	try {
		const body = await client(String(options.baseUrl)).performAction({
			kind: "alert",
			alertAction: options.dismiss ? "dismiss" : "accept",
		});
		if (options.json) {
			console.log(JSON.stringify(body, null, 2));
			return;
		}
		console.log(`ok ${body.kind}`);
	} catch (error) {
		fail("action alert", error);
	}
});

// --- setup / runtime (existing) ---

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
	.option("--force", "Force a full WebDriverAgent rebuild even when prep is reusable")
	.action(
		async (options: {
			baseUrl: string;
			json?: boolean;
			device?: string;
			kind?: string;
			xcode?: string;
			team?: string;
			identity?: string;
			force?: boolean;
		}) => {
			try {
				const kind =
					options.kind === "simulator" || options.kind === "physical" ? options.kind : undefined;
				const body = await client(options.baseUrl).setupPlatform({
					platform: "ios",
					deviceId: options.device,
					kind,
					xcodeDeveloperDir: options.xcode,
					developmentTeam: options.team,
					codeSignIdentity: options.identity,
					force: options.force === true,
				});
				if (options.json) {
					console.log(JSON.stringify(body, null, 2));
					return;
				}
				console.log(body.message);
				console.log(`driver: ${body.driver}${body.driverVersion ? ` ${body.driverVersion}` : ""}`);
				console.log(`appium: ${body.appiumVersion}`);
				if (body.wdaInstalled) {
					const action = body.wdaAction ?? "built";
					console.log(`wda: ${action} (${body.wdaBundleId ?? "unknown bundle"})`);
				}
			} catch (error) {
				fail("setup ios", error);
			}
		},
	);

setup
	.command("android")
	.description("Ensure Appium + uiautomator2 driver are installed")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).setupPlatform("android");
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.message);
			console.log(`driver: ${body.driver}${body.driverVersion ? ` ${body.driverVersion}` : ""}`);
			console.log(`appium: ${body.appiumVersion}`);
		} catch (error) {
			fail("setup android", error);
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
		try {
			const body = await client(options.baseUrl).getRuntimeStatus();
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
			fail("runtime status", error);
		}
	});

runtime
	.command("ensure")
	.description("Install Appium + both platform drivers if missing")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).ensureRuntime();
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
			fail("runtime ensure", error);
		}
	});

// --- apps / cases / flows / tags ---

const assertCmd = program
	.command("assert")
	.description("Assert text visibility on the active device");

for (const kind of ["visible", "not-visible"] as const) {
	assertCmd
		.command(kind)
		.description(
			kind === "visible"
				? "Fail unless matching text appears in the cleaned screen tree"
				: "Fail if matching text is still present in the cleaned screen tree",
		)
		.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
		.option("--json", "Print raw JSON")
		.requiredOption("-t, --text <text>", "Text / label substring to match")
		.option("--timeout <seconds>", "Seconds to wait before failing", (v) => Number(v), 5)
		.action(
			async (options: {
				baseUrl: string;
				json?: boolean;
				text: string;
				timeout: number;
			}) => {
				try {
					const line = formatAssertShellLine({
						assertion: kind,
						text: options.text,
						timeoutSeconds: options.timeout,
					});
					const result = await runYoqaShellScript(client(options.baseUrl), line);
					if (options.json) {
						console.log(JSON.stringify(result, null, 2));
						if (!result.ok) process.exitCode = 1;
						return;
					}
					if (!result.ok) {
						fail(`assert ${kind}`, new Error(result.error ?? "assertion failed"));
						return;
					}
					console.log(`ok assert ${kind}`);
				} catch (error) {
					fail(`assert ${kind}`, error);
				}
			},
		);
}

const appsCmd = program.command("apps").description("Manage local apps");

appsCmd
	.command("list")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const apps = await client(options.baseUrl).listApps();
			if (options.json) {
				console.log(JSON.stringify({ apps }, null, 2));
				return;
			}
			console.log(`${"PREFIX".padEnd(20)}NAME`);
			for (const app of apps) {
				console.log(`${app.prefix.padEnd(20)}${app.name}`);
			}
		} catch (error) {
			fail("apps list", error);
		}
	});

appsCmd
	.command("get")
	.argument("<app>", "App prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const app = await c.getApp(resolved.id);
			if (options.json) {
				console.log(JSON.stringify(app, null, 2));
				return;
			}
			console.log(`prefix: ${app.prefix}`);
			console.log(`name: ${app.name}`);
			console.log(`app_context: ${app.context || "(empty)"}`);
			console.log(`ios_bundle_id: ${app.iosBundleId || "(empty)"}`);
			console.log(`android_application_id: ${app.androidApplicationId || "(empty)"}`);
		} catch (error) {
			fail("apps get", error);
		}
	});

appsCmd
	.command("update")
	.argument("<app>", "App prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--name <name>", "Display name")
	.option("--prefix <prefix>", "CLI prefix")
	.option("--context <text>", "App context / shared rules")
	.option("--ios-bundle-id <id>", "iOS bundle id")
	.option("--android-application-id <id>", "Android application id")
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			options: {
				baseUrl: string;
				name?: string;
				prefix?: string;
				context?: string;
				iosBundleId?: string;
				androidApplicationId?: string;
				json?: boolean;
			},
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				const app = await c.updateApp(resolved.id, {
					name: options.name,
					prefix: options.prefix,
					context: options.context,
					iosBundleId: options.iosBundleId,
					androidApplicationId: options.androidApplicationId,
				});
				if (options.json) {
					console.log(JSON.stringify(app, null, 2));
					return;
				}
				console.log(`updated ${app.prefix}`);
			} catch (error) {
				fail("apps update", error);
			}
		},
	);

const casesCmd = program.command("cases").description("Manage test cases");

casesCmd
	.command("list")
	.argument("<app>", "App prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--tag <tag>", "Filter by tag")
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, options: { baseUrl: string; tag?: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			let cases = await c.listCases(resolved.id);
			const tag = options.tag;
			if (tag) {
				cases = cases.filter((item) => item.tags.includes(tag));
			}
			if (options.json) {
				console.log(JSON.stringify({ cases }, null, 2));
				return;
			}
			for (const item of cases) {
				console.log(`#${item.number}  ${item.name}`);
			}
		} catch (error) {
			fail("cases list", error);
		}
	});

casesCmd
	.command("get")
	.argument("<app>", "App prefix or id")
	.argument("<number>", "Case number", (v) => Number(v))
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, number: number, options: { baseUrl: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const cases = await c.listCases(resolved.id);
			const found = cases.find((item) => item.number === number);
			if (!found) throw new Error(`Case #${number} not found`);
			const detail = await c.getCase(found.id);
			if (options.json) {
				console.log(JSON.stringify(detail, null, 2));
				return;
			}
			console.log(`#${detail.number} ${detail.name}`);
			console.log(`tags: ${detail.tags.join(", ") || "(none)"}`);
			for (const step of detail.flows) {
				console.log(`- ${step.instructions}`);
				if (step.expectedResult) console.log(`  => ${step.expectedResult}`);
			}
		} catch (error) {
			fail("cases get", error);
		}
	});

casesCmd
	.command("create")
	.argument("<app>", "App prefix or id")
	.requiredOption("--title <title>", "Case title")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, options: { baseUrl: string; title: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const created = await c.createCase(resolved.id, {
				name: options.title,
				flows: [],
				tags: [],
			});
			if (options.json) {
				console.log(JSON.stringify(created, null, 2));
				return;
			}
			console.log(`created #${created.number} ${created.name}`);
		} catch (error) {
			fail("cases create", error);
		}
	});

casesCmd
	.command("update")
	.argument("<app>", "App prefix or id")
	.argument("<number>", "Case number", (v) => Number(v))
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--title <title>", "New title")
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			number: number,
			options: { baseUrl: string; title?: string; json?: boolean },
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				const cases = await c.listCases(resolved.id);
				const found = cases.find((item) => item.number === number);
				if (!found) throw new Error(`Case #${number} not found`);
				const updated = await c.updateCase(found.id, { name: options.title });
				if (options.json) {
					console.log(JSON.stringify(updated, null, 2));
					return;
				}
				console.log(`updated #${updated.number}`);
			} catch (error) {
				fail("cases update", error);
			}
		},
	);

casesCmd
	.command("delete")
	.argument("<app>", "App prefix or id")
	.argument("<number>", "Case number", (v) => Number(v))
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (appArg: string, number: number, options: { baseUrl: string }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const cases = await c.listCases(resolved.id);
			const found = cases.find((item) => item.number === number);
			if (!found) throw new Error(`Case #${number} not found`);
			await c.deleteCase(found.id);
			console.log(`deleted #${number}`);
		} catch (error) {
			fail("cases delete", error);
		}
	});

const flowsCmd = program.command("flows").description("Manage reusable flows");

flowsCmd
	.command("list")
	.argument("<app>", "App prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const flows = await c.listFlows(resolved.id);
			if (options.json) {
				console.log(JSON.stringify({ flows }, null, 2));
				return;
			}
			for (const flow of flows) {
				console.log(`${flow.id}  ${flow.name}`);
			}
		} catch (error) {
			fail("flows list", error);
		}
	});

flowsCmd
	.command("get")
	.argument("<app>", "App prefix or id")
	.argument("<flowId>", "Flow id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, flowId: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			await resolveAppId(c, appArg);
			const flow = await c.getFlow(flowId);
			if (options.json) {
				console.log(JSON.stringify(flow, null, 2));
				return;
			}
			console.log(flow.name);
			console.log(flow.instructions);
			if (flow.expectedResult) console.log(`=> ${flow.expectedResult}`);
		} catch (error) {
			fail("flows get", error);
		}
	});

flowsCmd
	.command("create")
	.argument("<app>", "App prefix or id")
	.requiredOption("--name <name>", "Flow name")
	.option("--instructions <text>", "Instructions", "")
	.option("--result <text>", "Expected result", "")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			options: {
				baseUrl: string;
				name: string;
				instructions?: string;
				result?: string;
				json?: boolean;
			},
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				const flow = await c.createFlow(resolved.id, {
					name: options.name,
					instructions: options.instructions ?? "",
					expectedResult: options.result ?? "",
				});
				if (options.json) {
					console.log(JSON.stringify(flow, null, 2));
					return;
				}
				console.log(`created ${flow.id} ${flow.name}`);
			} catch (error) {
				fail("flows create", error);
			}
		},
	);

flowsCmd
	.command("update")
	.argument("<app>", "App prefix or id")
	.argument("<flowId>", "Flow id")
	.option("--name <name>", "Flow name")
	.option("--instructions <text>", "Instructions")
	.option("--result <text>", "Expected result")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			flowId: string,
			options: {
				baseUrl: string;
				name?: string;
				instructions?: string;
				result?: string;
				json?: boolean;
			},
		) => {
			try {
				const c = client(options.baseUrl);
				await resolveAppId(c, appArg);
				const flow = await c.updateFlow(flowId, {
					name: options.name,
					instructions: options.instructions,
					expectedResult: options.result,
				});
				if (options.json) {
					console.log(JSON.stringify(flow, null, 2));
					return;
				}
				console.log(`updated ${flow.id}`);
			} catch (error) {
				fail("flows update", error);
			}
		},
	);

flowsCmd
	.command("delete")
	.argument("<app>", "App prefix or id")
	.argument("<flowId>", "Flow id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (appArg: string, flowId: string, options: { baseUrl: string }) => {
		try {
			const c = client(options.baseUrl);
			await resolveAppId(c, appArg);
			await c.deleteFlow(flowId);
			console.log(`deleted ${flowId}`);
		} catch (error) {
			fail("flows delete", error);
		}
	});

program
	.command("tags")
	.description("List tags for an app")
	.argument("<app>", "App prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const tags = await c.listTags(resolved.id);
			if (options.json) {
				console.log(JSON.stringify({ tags }, null, 2));
				return;
			}
			for (const tag of tags) {
				console.log(tag.name);
			}
		} catch (error) {
			fail("tags", error);
		}
	});

// --- builds ---

const buildsCmd = program.command("builds").description("Register local app builds");

buildsCmd
	.command("list")
	.argument("[app]", "Optional app prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string | undefined, options: { baseUrl: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			let appId: string | undefined;
			if (appArg) {
				appId = (await resolveAppId(c, appArg)).id;
			}
			const builds = await c.listBuilds(appId);
			if (options.json) {
				console.log(JSON.stringify({ builds }, null, 2));
				return;
			}
			for (const build of builds) {
				console.log(`${build.id}  ${build.platform.padEnd(8)} ${build.name}  ${build.path}`);
			}
		} catch (error) {
			fail("builds list", error);
		}
	});

buildsCmd
	.command("create")
	.argument("<path>", "Absolute path to .ipa / .app / .apk")
	.option("--app <app>", "App prefix or id")
	.option("--name <name>", "Display name")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(
		async (
			path: string,
			options: { baseUrl: string; app?: string; name?: string; json?: boolean },
		) => {
			try {
				const c = client(options.baseUrl);
				let appId: string | undefined;
				if (options.app) {
					appId = (await resolveAppId(c, options.app)).id;
				}
				const build = await c.createBuild({ path, appId, name: options.name });
				if (options.json) {
					console.log(JSON.stringify(build, null, 2));
					return;
				}
				console.log(`created ${build.id}`);
			} catch (error) {
				fail("builds create", error);
			}
		},
	);

buildsCmd
	.command("delete")
	.argument("<buildId>", "Build id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (buildId: string, options: { baseUrl: string }) => {
		try {
			await client(options.baseUrl).deleteBuild(buildId);
			console.log(`deleted ${buildId}`);
		} catch (error) {
			fail("builds delete", error);
		}
	});

// --- runs ---

const runsCmd = program.command("runs").description("Create and inspect local agent runs");

runsCmd
	.command("list")
	.argument("<app>", "App prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const runs = await c.listRuns(resolved.id);
			if (options.json) {
				console.log(JSON.stringify({ runs }, null, 2));
				return;
			}
			for (const run of runs) {
				console.log(`${run.id}  ${run.status.padEnd(10)} ${run.platform} ${run.deviceId}`);
			}
		} catch (error) {
			fail("runs list", error);
		}
	});

runsCmd
	.command("get")
	.argument("<runId>", "Run id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (runId: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const run = await client(options.baseUrl).getRun(runId);
			if (options.json) {
				console.log(JSON.stringify(run, null, 2));
				return;
			}
			console.log(`${run.id} ${run.status}`);
			for (const test of run.tests) {
				console.log(`  test ${test.caseId} ${test.status}${test.error ? ` — ${test.error}` : ""}`);
			}
		} catch (error) {
			fail("runs get", error);
		}
	});

runsCmd
	.command("report")
	.description("Export a detailed HTML or Markdown report with step screenshots")
	.argument("<runId>", "Run id")
	.option("--format <format>", "html | md (default: html)", "html")
	.option("-o, --output <path>", "Output file path (default: yoqa-run-<id>-<status>.html|md)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (runId: string, options: { baseUrl: string; format: string; output?: string }) => {
		try {
			const format =
				options.format === "md" || options.format === "markdown" ? "md" : options.format;
			if (format !== "html" && format !== "md") {
				throw new Error("--format must be html or md");
			}

			const c = client(options.baseUrl);
			const run = await c.getRun(runId);
			if (run.status === "queued" || run.status === "running") {
				throw new Error(
					`Run is still ${run.status}. Wait until it finishes (passed / errored / cancelled).`,
				);
			}

			const screenshotsByStepId: Record<string, string> = {};
			const steps = run.tests.flatMap((test) => test.steps ?? []);
			await Promise.all(
				steps.map(async (step) => {
					if (!step.screenshotUri) return;
					const response = await fetch(c.getRunStepScreenshotUrl(run.id, step.id));
					if (!response.ok) return;
					const bytes = new Uint8Array(await response.arrayBuffer());
					screenshotsByStepId[step.id] = Buffer.from(bytes).toString("base64");
				}),
			);

			const apps = await c.listApps();
			const app = apps.find((row) => row.id === run.appId);
			const cases = await c.listCases(run.appId);
			const caseTitles: Record<string, string> = {};
			for (const item of cases) {
				caseTitles[item.id] = `#${item.number} ${item.name}`;
			}

			let deviceLabel: string | null = run.deviceId;
			try {
				const devices = await c.listDevices(run.platform, { includeUnavailable: true });
				const device = devices.devices.find((row) => row.id === run.deviceId);
				if (device) {
					deviceLabel = `${device.name} · ${run.platform} ${device.osVersion}`;
				}
			} catch {
				/* device lookup optional */
			}

			const doc = buildRunReportFromCatalogRun(
				run,
				{
					appLabel: app ? `${app.prefix} — ${app.name}` : run.appId,
					deviceLabel,
					caseTitles,
				},
				screenshotsByStepId,
			);

			const contents = format === "html" ? formatRunReportHtml(doc) : formatRunReportMarkdown(doc);
			const extension = format === "html" ? "html" : "md";
			const outputPath =
				options.output?.trim() || `${suggestedRunReportBasename(doc)}.${extension}`;
			await Bun.write(outputPath, contents);
			console.log(`wrote ${outputPath} (${doc.status}, ${steps.length} steps)`);
		} catch (error) {
			fail("runs report", error);
		}
	});

runsCmd
	.command("delete")
	.argument("<runId>", "Run id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (runId: string, options: { baseUrl: string }) => {
		try {
			await client(options.baseUrl).deleteRun(runId);
			console.log(`deleted ${runId}`);
		} catch (error) {
			fail("runs delete", error);
		}
	});

runsCmd
	.command("create")
	.argument("<app>", "App prefix or id")
	.requiredOption("--cases <numbers>", "Comma-separated case numbers, e.g. 1,2,5")
	.option("--device <id>", "Device id (defaults to active session)")
	.option("--platform <platform>", "ios | android (defaults to active session)")
	.option("--build-id <id>", "Registered build id to install before run")
	.option("--build-path <path>", "Absolute build path to register + install")
	.option("--mode <mode>", "auto | script | agent (default: auto)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			options: {
				baseUrl: string;
				cases: string;
				device?: string;
				platform?: string;
				buildId?: string;
				buildPath?: string;
				mode?: string;
				json?: boolean;
			},
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				const numbers = options.cases
					.split(",")
					.map((s) => Number(s.trim()))
					.filter((n) => Number.isFinite(n));
				if (numbers.length === 0) throw new Error("Provide at least one case number via --cases");

				const catalogCases = await c.listCases(resolved.id);
				const caseIds: string[] = [];
				for (const num of numbers) {
					const found = catalogCases.find((item) => item.number === num);
					if (!found) throw new Error(`Case #${num} not found`);
					caseIds.push(found.id);
				}

				let deviceId = options.device;
				let platform = options.platform as DevicePlatform | undefined;
				if (!deviceId || !platform) {
					const active = await c.getActiveDevice();
					if (!active) {
						throw new Error(
							"No --device/--platform and no active session. Connect first or pass both flags.",
						);
					}
					deviceId = deviceId ?? active.deviceId;
					platform = platform ?? active.platform;
				}
				if (platform !== "ios" && platform !== "android") {
					throw new Error("--platform must be ios or android");
				}

				const executionMode =
					options.mode === "script" || options.mode === "agent" || options.mode === "auto"
						? options.mode
						: undefined;
				if (options.mode && !executionMode) {
					throw new Error("--mode must be auto, script, or agent");
				}

				const run = await c.createRun({
					appId: resolved.id,
					caseIds,
					deviceId,
					platform,
					buildId: options.buildId,
					buildPath: options.buildPath,
					executionMode,
				});
				if (options.json) {
					console.log(JSON.stringify(run, null, 2));
					return;
				}
				console.log(`created ${run.id} (${run.status})`);
			} catch (error) {
				fail("runs create", error);
			}
		},
	);

// --- script (exported CaseScript JSON) ---

const scriptCmd = program.command("script").description("Replay exported CaseScript files");

scriptCmd
	.command("run")
	.argument("<file>", "Path to a .yoqa.json / CaseScript JSON file")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON per step")
	.action(async (file: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const raw = await Bun.file(file).text();
			const parsed = caseScriptSchema.safeParse(JSON.parse(raw) as unknown);
			if (!parsed.success) {
				throw new Error(`Invalid CaseScript: ${parsed.error.message}`);
			}

			const c = client(options.baseUrl);
			const active = await c.getActiveDevice();
			if (!active) {
				throw new Error("No active device session. Connect first: yoqa devices connect <id>");
			}

			const script = parsed.data;
			let idx = 0;
			for (const action of script.actions) {
				idx += 1;
				if (action.type === "wait") {
					const ms = Math.min(3000, Math.max(500, action.ms));
					if (options.json) {
						console.log(JSON.stringify({ ok: true, kind: "wait", ms, step: idx }, null, 2));
					} else {
						console.log(`ok wait ${ms}ms (${idx}/${script.actions.length})`);
					}
					await Bun.sleep(ms);
					continue;
				}

				const body =
					action.type === "tap"
						? await c.performAction({ kind: "tap", x: action.x, y: action.y })
						: await c.performAction({ kind: "input", text: action.text });

				if (options.json) {
					console.log(JSON.stringify({ ...body, step: idx }, null, 2));
				} else {
					console.log(`ok ${body.kind} (${idx}/${script.actions.length})`);
				}
				await Bun.sleep(800);
			}

			if (!options.json) {
				console.log(`done ${script.actions.length} steps`);
			}
		} catch (error) {
			fail("script run", error);
		}
	});

await program.parseAsync(process.argv);
