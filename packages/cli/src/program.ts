import { readFile, writeFile } from "node:fs/promises";
import {
	ASSERT_EXIT_CODE,
	type ActionRequest,
	type ActionResponse,
	type ActiveDeviceResponse,
	type ConnectDeviceRequest,
	type DevicePlatform,
	KEY_MODIFIERS,
	KEY_NAMES,
	RunnerRequestError,
	WaitForRunTimeoutError,
	caseScriptActionCommand,
	checkScreen,
	createCaseFlowsSchema,
	createRunnerClient,
	developerNotTrusted,
	everydayWarningRequired,
	formatCaseScriptFile,
	formatCaseScriptFileErrors,
	formatCaseScriptReplayStep,
	formatCaseScriptShell,
	formatCaseScriptStepPath,
	formatViewportPreset,
	parseCaseScriptFile,
	parseKeyModifiers,
	parseKeyName,
	runCaseScript,
	screenCheckMissMessage,
	updateCaseFlowsSchema,
	waitForRun,
} from "@yoqa/runner-client";
import { Command } from "commander";
import { yoqaBenchmarkDriver } from "../../../services/runner/src/domains/benchmark/drivers";
import { runLatencyScenario } from "../../../services/runner/src/domains/benchmark/scenario";
import {
	DEFAULT_BENCHMARK_SUITE,
	parseBenchmarkArms,
	parseBenchmarkSuite,
} from "../../../services/runner/src/domains/benchmark/suite";
import {
	type LatencyRunInput,
	formatLatencyTable,
	recommendScreenDefault,
	summarizeLatency,
} from "../../../services/runner/src/domains/benchmark/summarize";
import packageJson from "../package.json" with { type: "json" };
import { findCatalogApp } from "./catalog-app";
import { formatDoctorReport } from "./doctor-table";
import {
	commandChainIncludes,
	ensureRunner,
	fetchRunnerHealth,
	runnerBaseUrlFromEnv,
	shouldSkipAutostart,
	stopOwnedRunner,
} from "./ensure-runner";
import {
	PLATFORM_DEVICES_DESCRIPTION,
	connectPlatform,
	everydayBrowserName,
	isEverydayDeviceId,
	isWebDeviceId,
	parsePlatform,
	parseViewportPreset,
} from "./platform";
import {
	DEFAULT_RUN_WAIT_TIMEOUT_SECONDS,
	type ReportCommandOptions,
	attachGithubOutputOptions,
	attachReportCommandOptions,
	createWaitStatusLogger,
	exportCatalogRunReport,
	maybeWriteGithubRunOutput,
	parseTimeoutSeconds,
	resolveReportRunId,
	shouldFailOnRunStatus,
} from "./report";
import {
	formatDeveloperNotTrusted,
	formatSigningCheck,
	formatSigningStatus,
	pickCheckDevice,
} from "./signing";

function runnerBaseUrl(): string {
	return runnerBaseUrlFromEnv();
}

const program = new Command();

program
	.name("yoqa")
	.description("Local Yoqa CLI (talks to the local runner over HTTP)")
	.version(packageJson.version);

function client(baseUrl: string) {
	return createRunnerClient({ baseUrl });
}

/**
 * `web web-chrome lane direct viewport mobile (390×844)`: a Device Session in one line, with
 * the Everyday browser's profile (`profile Work`) when it was read.
 */
function describeSession(body: ActiveDeviceResponse): string {
	const viewport = body.viewport ? ` viewport ${formatViewportPreset(body.viewport)}` : "";
	const profile = body.browserProfileName ? ` profile ${body.browserProfileName}` : "";
	return `${body.platform} ${body.deviceId} lane ${body.lane ?? "direct"}${viewport}${profile}`;
}

function fail(command: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`yoqa ${command} failed: ${message}`);
	// A runner that answered with an error is up; the hint is for one that did not answer.
	if (
		!(error instanceof RunnerRequestError) &&
		!message.includes("yoqa serve") &&
		!message.includes("Bun")
	) {
		console.error("Is the runner up? Try: yoqa serve");
	}
	process.exitCode = 1;
}

program
	.command("serve")
	.description("Start the local Yoqa runner in the foreground (no desktop app required)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--stop", "Stop a runner previously started by yoqa (pid file)")
	.action(async (options: { baseUrl: string; stop?: boolean }) => {
		try {
			if (options.stop) {
				const result = await stopOwnedRunner();
				console.log(result.message);
				if (!result.ok) process.exitCode = 1;
				return;
			}
			const baseUrl = options.baseUrl;
			const health = await fetchRunnerHealth(baseUrl);
			if (health) {
				console.log(`already running at ${baseUrl} (${health.version})`);
				return;
			}
			await ensureRunner({ mode: "foreground", baseUrl });
		} catch (error) {
			fail("serve", error);
		}
	});

program.hook("preAction", async (_thisCommand, actionCommand) => {
	if (commandChainIncludes(actionCommand, "serve")) return;
	// Checking a Case Script file is offline: no runner, no device.
	if (commandChainIncludes(actionCommand, "script") && actionCommand.name() === "validate") return;
	if (shouldSkipAutostart()) return;
	try {
		await ensureRunner({ mode: "detached" });
	} catch (error) {
		fail("autostart", error);
		throw error;
	}
});

async function resolveAppId(
	c: ReturnType<typeof client>,
	prefixOrId: string,
): Promise<{ id: string; prefix: string; name: string }> {
	const apps = await c.listApps();
	const match = findCatalogApp(apps, prefixOrId);
	if (!match) {
		throw new Error(`App not found: ${prefixOrId}. Run: yoqa apps list`);
	}
	return { id: match.id, prefix: match.prefix, name: match.name };
}

/** A Case Script file: `*.yoqa.yaml` (or a legacy `.yoqa.json`). */
async function loadCaseScriptFile(file: string) {
	const parsed = parseCaseScriptFile(await readFile(file, "utf8"));
	if (!parsed.ok) {
		throw new Error(
			`Invalid Case Script file ${file}:\n${formatCaseScriptFileErrors(parsed.errors)}`,
		);
	}
	return parsed;
}

/** Flow steps for a new case: a JSON array of `{flowId}` and/or `{instructions, expectedResult}`. */
async function loadCreateCaseFlowsFile(file: string) {
	const raw = await readFile(file, "utf8");
	const parsed = createCaseFlowsSchema.safeParse(JSON.parse(raw) as unknown);
	if (!parsed.success) {
		throw new Error(`Invalid case flows file: ${parsed.error.message}`);
	}
	return parsed.data;
}

/** Same as `loadCreateCaseFlowsFile`, but a step may carry its existing `id`. */
async function loadUpdateCaseFlowsFile(file: string) {
	const raw = await readFile(file, "utf8");
	const parsed = updateCaseFlowsSchema.safeParse(JSON.parse(raw) as unknown);
	if (!parsed.success) {
		throw new Error(`Invalid case flows file: ${parsed.error.message}`);
	}
	return parsed.data;
}

/** Commander accumulator for a repeatable flag. */
function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}

async function handleReportCommand(
	commandLabel: string,
	runIdArg: string | undefined,
	options: ReportCommandOptions,
): Promise<void> {
	try {
		const c = client(options.baseUrl);
		let latestAppId: string | undefined;
		if (options.latest) {
			latestAppId = (await resolveAppId(c, options.latest)).id;
		}
		const runId = await resolveReportRunId(c, runIdArg, latestAppId, options.latest ?? "");
		const result = await exportCatalogRunReport(c, runId, options, {
			onWaitStatus: createWaitStatusLogger(),
		});
		if (result.shouldFail) process.exitCode = 1;
	} catch (error) {
		fail(commandLabel, error);
	}
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
	.description("Show local runner, provider, and active device status")
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
		unavailableReason?: string;
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
		if (device.unavailableReason) {
			console.log(`           Not a target: ${device.unavailableReason}`);
		}
		if (isEverydayDeviceId(device.id) && device.state === "remote debugging off") {
			console.log("           Turn it on at chrome://inspect/#remote-debugging, then connect");
		}
	}
}

const platformDevices = {} as Record<DevicePlatform, Command>;
for (const platform of Object.keys(PLATFORM_DEVICES_DESCRIPTION) as DevicePlatform[]) {
	platformDevices[platform] = devices
		.command(platform)
		.description(PLATFORM_DEVICES_DESCRIPTION[platform])
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

// --base-url and --json are `devices web`'s, which parses them wherever they are.
platformDevices.web
	.command("reset-profile")
	.description(
		"Delete a Kept browser profile, signing out of every site in it (refused while its browser is open)",
	)
	.option("--app <app>", "App prefix or id whose profile to reset (default: the default profile)")
	.option("--browser <id>", "One browser's profile, e.g. web-chrome (default: every browser's)")
	.configureHelp({ showGlobalOptions: true })
	.action(async (_options: unknown, command: Command) => {
		const options = command.optsWithGlobals<{
			app?: string;
			browser?: string;
			baseUrl: string;
			json?: boolean;
		}>();
		try {
			const c = client(options.baseUrl);
			// A profile outlives its App, so an id the catalog no longer has is reset as given.
			const appId = options.app
				? (findCatalogApp(await c.listApps(), options.app)?.id ?? options.app)
				: undefined;
			const body = await c.resetWebProfile({ appId, browserId: options.browser });
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			if (body.browserIds.length === 0) {
				const browser = options.browser ? ` in ${options.browser}` : "";
				console.log(`No Kept profile for ${body.appId}${browser} to reset.`);
				return;
			}
			console.log(`reset the Kept profile for ${body.appId} in ${body.browserIds.join(", ")}`);
		} catch (error) {
			fail("devices web reset-profile", error);
		}
	});

/**
 * How long a connect to the Everyday browser runs before the CLI says to click Allow. The
 * runner refuses a connect whose App has not accepted the warning at once, before any prompt.
 */
const ALLOW_LINE_DELAY_MS = 250;

/**
 * Connect to the Everyday browser, saying to click Allow while the runner waits on the user,
 * and cancelling the wait on Ctrl-C. Null when the user cancelled it.
 */
async function connectEveryday(
	c: ReturnType<typeof client>,
	request: ConnectDeviceRequest,
	browser: string,
): Promise<ActiveDeviceResponse | null> {
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	// On stderr, so --json still prints only the session.
	const allowLine = setTimeout(
		() => console.error(`Click Allow in ${browser}… (up to 60 s; Ctrl-C cancels)`),
		ALLOW_LINE_DELAY_MS,
	);
	try {
		return await c.connectDevice(request, { signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted) return null;
		throw error;
	} finally {
		clearTimeout(allowLine);
		process.off("SIGINT", cancel);
	}
}

devices
	.command("connect")
	.description("Open a Device Session on a device")
	.argument(
		"<deviceId>",
		"Device UDID / serial, a browser id (web-chrome), your Everyday browser (web-chrome-everyday), or chromium-cdp-<port> for a Chromium you started (CI)",
	)
	.option("--platform <platform>", "ios | android | web (web for web-* and chromium-cdp-<port>)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--bundle-id <id>", "iOS bundle id to launch")
	.option("--app-package <id>", "Android application id to launch")
	.option("--lane <lane>", "direct | auto (the only Lane is Direct)")
	.option(
		"--viewport <preset>",
		"Web only: desktop (1280×800, the default) | mobile (390×844, touch and a mobile user agent)",
	)
	.option(
		"--app <app>",
		"Web only: App prefix or id whose Kept profile to open, and whose Everyday browser warning applies (default: the default profile)",
	)
	.option("--yes", "Everyday browser only: accept its first-use warning for the App")
	.option("--json", "Print raw JSON")
	.action(
		async (
			deviceId: string,
			options: {
				baseUrl: string;
				platform?: string;
				bundleId?: string;
				appPackage?: string;
				lane?: string;
				viewport?: string;
				app?: string;
				yes?: boolean;
				json?: boolean;
			},
		) => {
			const everyday = everydayBrowserName(deviceId);
			try {
				const platform = connectPlatform(deviceId, options.platform);
				const lane = options.lane;
				if (lane != null && lane !== "direct" && lane !== "auto") {
					throw new Error("--lane must be direct or auto");
				}
				const viewport = parseViewportPreset(options.viewport, platform);
				if (options.app && platform !== "web") {
					throw new Error("--app is for web devices: a phone takes --bundle-id or --app-package");
				}
				const c = client(options.baseUrl);
				const appId = options.app ? (await resolveAppId(c, options.app)).id : undefined;
				const request: ConnectDeviceRequest = {
					deviceId,
					platform,
					bundleId: options.bundleId,
					appPackage: options.appPackage,
					lane,
					...(viewport ? { viewport } : {}),
					...(appId ? { appId } : {}),
					...(everyday && options.yes ? { acceptEverydayWarning: true } : {}),
				};
				const body = everyday
					? await connectEveryday(c, request, everyday)
					: await c.connectDevice(request);
				if (!body) {
					console.error(`yoqa devices connect cancelled before Allow in ${everyday}`);
					process.exitCode = 130;
					return;
				}
				if (options.json) {
					console.log(JSON.stringify(body, null, 2));
					return;
				}
				console.log(`connected ${describeSession(body)}`);
				if (body.laneWarning) console.log(`lane warning: ${body.laneWarning}`);
			} catch (error) {
				const warning = everydayWarningRequired(error);
				if (warning) {
					const app = options.app ? ` --app ${options.app}` : "";
					console.error(
						`${warning.warning}\n\nTo accept this for ${warning.appId} and connect, run:\n  yoqa devices connect ${deviceId}${app} --yes`,
					);
					process.exitCode = 1;
					return;
				}
				const untrusted = developerNotTrusted(error);
				if (untrusted && !options.json) {
					console.error(
						formatDeveloperNotTrusted(
							untrusted,
							`yoqa devices connect ${deviceId} --platform ${options.platform}`,
						),
					);
					process.exitCode = 1;
					return;
				}
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
			console.log(describeSession(body));
			if (body.laneWarning) console.log(`lane warning: ${body.laneWarning}`);
		} catch (error) {
			fail("devices active", error);
		}
	});

devices
	.command("disconnect")
	.description("Close the active Device Session")
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
	.option("--full", "Return the raw accessibility tree")
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
		.option("--app-id <id>", "Bundle id / application id, or the Web URL on web")
		.option("--url <url>", "URL to open")
		.option("--seconds <n>", "Background seconds", (v) => Number(v))
		.option(
			"--screenshot",
			"Wait for the screen to settle, then return the result screenshot (and a copy marking where the tap or swipe landed)",
		)
		.option(
			"--settle <ms>",
			"With --screenshot: longest wait for the screen to settle (default 1500)",
			(v) => Number(v),
		)
		.option(
			"--full",
			"With --screenshot: return the raw Result screenshot instead of the Agent image",
		)
		.option(
			"--scale <n>",
			"With --screenshot: Agent image scale 0.01–1 (default: long edge ~1000 px)",
			(v) => Number(v),
		);
}

function printResultScreenshot(shot: NonNullable<ActionResponse["screenshot"]>): void {
	console.log(`screenshot ${shot.path}`);
	if (shot.rawPath) console.log(`raw ${shot.rawPath}`);
	if (shot.annotatedPath) console.log(`marked ${shot.annotatedPath}`);
	console.log(`settled ${shot.settled} (${Math.round(shot.waitedMs)}ms)`);
	console.log(
		`changed ${shot.changed === null ? "unknown (screen still animating)" : shot.changed}`,
	);
}

function printActionPhases(phases: NonNullable<ActionResponse["phases"]>): void {
	console.log(
		`phases capture=${phases.captureMs} action=${phases.actionMs} settle=${phases.settleMs}`,
	);
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
					screenshot: options.screenshot === true ? true : undefined,
					settleMs: options.settle as number | undefined,
					fullImage: options.full === true ? true : undefined,
					imageScale: options.scale as number | undefined,
				});
				if (options.json) {
					console.log(JSON.stringify(body, null, 2));
					return;
				}
				console.log(`ok ${body.kind}`);
				if (body.resolved?.x != null && body.resolved?.y != null) {
					console.log(`resolved ${body.resolved.x},${body.resolved.y}`);
				}
				if (body.screenshot) printResultScreenshot(body.screenshot);
				if (body.phases) printActionPhases(body.phases);
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
			screenshot: options.screenshot === true ? true : undefined,
			settleMs: options.settle as number | undefined,
			fullImage: options.full === true ? true : undefined,
			imageScale: options.scale as number | undefined,
		});
		if (options.json) {
			console.log(JSON.stringify(body, null, 2));
			return;
		}
		console.log(`ok ${body.kind}`);
		if (body.screenshot) printResultScreenshot(body.screenshot);
	} catch (error) {
		fail("action alert", error);
	}
});

addActionOptions(
	action
		.command("key")
		.description(`Press a key: ${KEY_NAMES.join(", ")}`)
		.argument("<key>", "Key name, in any case")
		.option(
			"--modifiers <list>",
			`Held while the key is pressed, comma-separated: ${KEY_MODIFIERS.join(", ")}`,
		),
).action(async (keyName: string, options: Record<string, unknown>) => {
	try {
		const key = parseKeyName(keyName);
		const modifiers =
			typeof options.modifiers === "string" ? parseKeyModifiers(options.modifiers) : [];
		const body = await client(String(options.baseUrl)).performAction({
			kind: "key",
			key,
			...(modifiers.length > 0 ? { modifiers } : {}),
			screenshot: options.screenshot === true ? true : undefined,
			settleMs: options.settle as number | undefined,
			fullImage: options.full === true ? true : undefined,
			imageScale: options.scale as number | undefined,
		});
		if (options.json) {
			console.log(JSON.stringify(body, null, 2));
			return;
		}
		console.log(`ok ${body.kind}`);
		if (body.screenshot) printResultScreenshot(body.screenshot);
		if (body.phases) printActionPhases(body.phases);
	} catch (error) {
		fail("action key", error);
	}
});

addActionOptions(
	action
		.command("batch")
		.description(
			"Run known Actions from a JSON file or stdin (one Settle and Result screenshot at the end). Description-grounded steps are rejected.",
		)
		.argument("[file]", "JSON file of { steps: Action[] } or an Action array. Omit to read stdin."),
).action(async (file: string | undefined, options: Record<string, unknown>) => {
	try {
		const raw = file
			? await readFile(file, "utf8")
			: await new Promise<string>((resolve, reject) => {
					const chunks: Buffer[] = [];
					process.stdin.on("data", (chunk) => {
						chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					});
					process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
					process.stdin.on("error", reject);
				});
		const parsed: unknown = JSON.parse(raw);
		const steps = Array.isArray(parsed)
			? parsed
			: parsed && typeof parsed === "object" && "steps" in parsed
				? (parsed as { steps: unknown }).steps
				: null;
		if (!Array.isArray(steps) || steps.length === 0) {
			throw new Error("Batch JSON must be an Action array or { steps: Action[] }");
		}
		const body = await client(String(options.baseUrl)).performActionBatch({
			steps: steps as ActionRequest[],
			settleMs: options.settle as number | undefined,
			fullImage: options.full === true ? true : undefined,
			imageScale: options.scale as number | undefined,
		});
		if (options.json) {
			console.log(JSON.stringify(body, null, 2));
			return;
		}
		console.log(`batch ${body.ok ? "ok" : "failed"} ${body.completed}/${body.total}`);
		if (body.failedIndex != null) console.log(`failedIndex ${body.failedIndex}`);
		if (body.error) console.log(body.error);
		if (body.screenshot) printResultScreenshot(body.screenshot);
		if (!body.ok) process.exitCode = 1;
	} catch (error) {
		fail("action batch", error);
	}
});

// --- servers / doctor ---

const servers = program
	.command("servers")
	.description("List or control the local runner and device sessions")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).listServers();
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			if (body.servers.length === 0) {
				console.log("No servers running");
				return;
			}
			for (const entry of body.servers) {
				const meta = [
					entry.kind,
					entry.ownership,
					entry.status,
					entry.port ? `:${entry.port}` : null,
					entry.pid ? `pid ${entry.pid}` : null,
					entry.actions.length > 0 ? `actions=${entry.actions.join(",")}` : "actions=none",
				]
					.filter(Boolean)
					.join(" · ");
				console.log(`${entry.id}\t${entry.label}\t${meta}`);
			}
		} catch (error) {
			fail("servers", error);
		}
	});

servers
	.command("list")
	.description("List running servers")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).listServers();
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			if (body.servers.length === 0) {
				console.log("No servers running");
				return;
			}
			for (const entry of body.servers) {
				const meta = [
					entry.kind,
					entry.ownership,
					entry.status,
					entry.port ? `:${entry.port}` : null,
					entry.pid ? `pid ${entry.pid}` : null,
					entry.actions.length > 0 ? `actions=${entry.actions.join(",")}` : "actions=none",
				]
					.filter(Boolean)
					.join(" · ");
				console.log(`${entry.id}\t${entry.label}\t${meta}`);
			}
		} catch (error) {
			fail("servers list", error);
		}
	});

servers
	.command("stop-all")
	.description("Disconnect the device session (does not stop the runner)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const body = await client(options.baseUrl).stopAllServers();
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.message);
		} catch (error) {
			fail("servers stop-all", error);
		}
	});

servers
	.command("stop")
	.description("Stop one server by id")
	.argument("<id>", "Server id from yoqa servers list")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (id: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			if (id === "runner-self") {
				throw new Error(
					"Stopping the runner over HTTP is not supported. Quit the desktop app or kill the process on the runner port.",
				);
			}
			const body = await client(options.baseUrl).stopServer(id);
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.message);
		} catch (error) {
			fail("servers stop", error);
		}
	});

servers
	.command("restart")
	.description("Restart one server by id")
	.argument("<id>", "Server id from yoqa servers list")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (id: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			if (id === "runner-self") {
				throw new Error(
					"Restarting the runner over HTTP is not supported while it is serving requests. Prefer the desktop Servers panel.",
				);
			}
			const body = await client(options.baseUrl).restartServer(id);
			if (options.json) {
				console.log(JSON.stringify(body, null, 2));
				return;
			}
			console.log(body.message);
		} catch (error) {
			fail("servers restart", error);
		}
	});

program
	.command("doctor")
	.description("Diagnose local tooling and the device session")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--fix", "Apply safe repairs (disconnect a stuck session)")
	.action(async (options: { baseUrl: string; json?: boolean; fix?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			if (options.fix) {
				const report = await c.getDoctorReport();
				const repairs = [
					...new Set(
						report.steps
							.map((step) => step.repair)
							.filter((id): id is NonNullable<typeof id> => Boolean(id)),
					),
				];
				if (repairs.length === 0) {
					if (options.json) {
						console.log(JSON.stringify({ ok: true, message: "No safe repairs", report }, null, 2));
					} else {
						console.log("No safe repairs to apply");
					}
					if (!report.ok) process.exitCode = 1;
					return;
				}
				const result = await c.repairDoctor({ repairs });
				if (options.json) {
					console.log(JSON.stringify(result, null, 2));
				} else {
					console.log(result.message);
					console.log(formatDoctorReport(result.report));
				}
				if (!result.report.ok) process.exitCode = 1;
				return;
			}

			const report = await c.getDoctorReport();
			if (options.json) {
				console.log(JSON.stringify(report, null, 2));
			} else {
				console.log(formatDoctorReport(report));
			}
			if (!report.ok) process.exitCode = 1;
		} catch (error) {
			fail("doctor", error);
		}
	});

// --- signing (physical iPhones) ---

const signing = program
	.command("signing")
	.description("Choose and check the Apple team that signs YoqaRunner for physical iPhones")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (options: { baseUrl: string; json?: boolean }) => {
		try {
			const status = await client(options.baseUrl).getIosSigning();
			console.log(options.json ? JSON.stringify(status, null, 2) : formatSigningStatus(status));
		} catch (error) {
			fail("signing", error);
		}
	});

signing
	.command("use")
	.description(
		"Sign with this team ID from now on (desktop and CLI); `auto` uses the newest certificate",
	)
	.argument("<team>", "Ten-character Apple team ID, or auto")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(async (team: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const status = await client(options.baseUrl).setIosSigningTeam(
				team.toLowerCase() === "auto" ? null : team,
			);
			console.log(options.json ? JSON.stringify(status, null, 2) : formatSigningStatus(status));
		} catch (error) {
			fail("signing use", error);
		}
	});

signing
	.command("check")
	.description(
		"Sign YoqaRunner for a cabled iPhone now; registers the phone and refreshes the profile",
	)
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--device <udid>", "iPhone UDID (default: the one cabled iPhone)")
	.action(async (options: { baseUrl: string; json?: boolean; device?: string }) => {
		try {
			const c = client(options.baseUrl);
			const deviceId = pickCheckDevice(
				options.device,
				options.device ? [] : (await c.listDevices("ios")).devices,
			);
			if (!options.json) console.error(`Signing YoqaRunner for ${deviceId}…`);
			const check = await c.checkIosSigning({ deviceId });
			console.log(options.json ? JSON.stringify(check, null, 2) : formatSigningCheck(check));
			if (!check.ok) process.exitCode = 1;
		} catch (error) {
			fail("signing check", error);
		}
	});

// --- apps / cases / flows / tags ---

const assertCmd = program
	.command("assert")
	.description("Assert text or id visibility on the active device");

for (const kind of ["visible", "not-visible"] as const) {
	assertCmd
		.command(kind)
		.description(
			kind === "visible"
				? "Fail unless matching text or id appears in the cleaned screen tree"
				: "Fail if matching text or id is still present in the cleaned screen tree",
		)
		.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
		.option("--json", "Print raw JSON")
		.option("-t, --text <text>", "Text / label substring to match")
		.option("--id <id>", "Element id to match, as a tap by id does (instead of --text)")
		.option("--timeout <seconds>", "Seconds to wait before failing", (v) => Number(v), 5)
		.action(
			async (options: {
				baseUrl: string;
				json?: boolean;
				text?: string;
				id?: string;
				timeout: number;
			}) => {
				// A usage error, not a runner one: no "Is the runner up?" hint.
				if ((options.text == null) === (options.id == null)) {
					const usage =
						options.text != null
							? "pass --text or --id, not both"
							: "pass --text <text> or --id <id>";
					console.error(`yoqa assert ${kind} failed: ${usage}`);
					process.exitCode = ASSERT_EXIT_CODE.couldNotCheck;
					return;
				}
				const check = {
					assertion: kind,
					...(options.id != null ? { id: options.id } : { text: options.text }),
					timeoutMs: options.timeout * 1000,
				};
				try {
					const c = client(options.baseUrl);
					const { met } = await checkScreen({
						...check,
						readScreen: () => c.getScreen(),
						sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
						now: Date.now,
					});
					const error = met ? undefined : screenCheckMissMessage(check);
					if (!met) process.exitCode = ASSERT_EXIT_CODE.notMet;
					if (options.json) {
						console.log(
							JSON.stringify({ ok: met, completed: met ? 1 : 0, total: 1, error }, null, 2),
						);
						return;
					}
					if (error) {
						console.error(`yoqa assert ${kind} failed: ${error}`);
						return;
					}
					console.log(`ok assert ${kind}`);
				} catch (error) {
					// Not a miss: the Screen could not be checked, so a Branch must not take `else`.
					fail(`assert ${kind}`, error);
					process.exitCode = ASSERT_EXIT_CODE.couldNotCheck;
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
	.command("create")
	.description("Create a local catalog app")
	.requiredOption("--name <name>", "Display name")
	.option("--prefix <prefix>", "CLI prefix (allocated from name when omitted)")
	.option("--ios-bundle-id <id>", "iOS bundle id")
	.option("--android-application-id <id>", "Android application id")
	.option("--web-url <url>", "Web URL a Run on web opens (http or https)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(
		async (options: {
			baseUrl: string;
			name: string;
			prefix?: string;
			iosBundleId?: string;
			androidApplicationId?: string;
			webUrl?: string;
			json?: boolean;
		}) => {
			try {
				const c = client(options.baseUrl);
				let app = await c.createApp({
					name: options.name,
					prefix: options.prefix,
					webUrl: options.webUrl,
				});
				if (options.iosBundleId || options.androidApplicationId) {
					app = await c.updateApp(app.id, {
						iosBundleId: options.iosBundleId,
						androidApplicationId: options.androidApplicationId,
					});
				}
				if (options.json) {
					console.log(JSON.stringify(app, null, 2));
					return;
				}
				console.log(`created ${app.prefix}`);
			} catch (error) {
				fail("apps create", error);
			}
		},
	);

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
			console.log(`app_knowledge: ${app.knowledge || "(empty)"}`);
			console.log(`ios_bundle_id: ${app.iosBundleId || "(empty)"}`);
			console.log(`android_application_id: ${app.androidApplicationId || "(empty)"}`);
			console.log(`web_url: ${app.webUrl || "(empty)"}`);
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
	.option("--knowledge <text>", "App knowledge notes injected into agent runs")
	.option("--ios-bundle-id <id>", "iOS bundle id")
	.option("--android-application-id <id>", "Android application id")
	.option("--web-url <url>", "Web URL a Run on web opens (empty clears it)")
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			options: {
				baseUrl: string;
				name?: string;
				prefix?: string;
				context?: string;
				knowledge?: string;
				iosBundleId?: string;
				androidApplicationId?: string;
				webUrl?: string;
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
					knowledge: options.knowledge,
					iosBundleId: options.iosBundleId,
					androidApplicationId: options.androidApplicationId,
					webUrl: options.webUrl,
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
	.option("--tag <tag>", "Filter by tag (repeatable; a case must carry every tag)", collect, [])
	.option("--json", "Print raw JSON")
	.action(async (appArg: string, options: { baseUrl: string; tag: string[]; json?: boolean }) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			let cases = await c.listCases(resolved.id);
			const tags = options.tag;
			if (tags.length > 0) {
				cases = cases.filter((item) => tags.every((tag) => item.tags.includes(tag)));
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
	.option("--tag <tag>", "Tag to attach (repeatable; created if missing)", collect, [])
	.option("--flows-file <path>", "Path to a JSON array of flow steps")
	.option(
		"--script-file <path>",
		"Path to a Case Script file (.yoqa.yaml, or legacy .yoqa.json) to attach",
	)
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			options: {
				baseUrl: string;
				title: string;
				tag: string[];
				flowsFile?: string;
				scriptFile?: string;
				json?: boolean;
			},
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				let created = await c.createCase(resolved.id, {
					name: options.title,
					flows: options.flowsFile ? await loadCreateCaseFlowsFile(options.flowsFile) : [],
					tags: options.tag,
				});
				if (options.scriptFile) {
					created = await c.updateCase(created.id, {
						script: (await loadCaseScriptFile(options.scriptFile)).script,
					});
				}
				if (options.json) {
					console.log(JSON.stringify(created, null, 2));
					return;
				}
				console.log(`created #${created.number} ${created.name}`);
			} catch (error) {
				fail("cases create", error);
			}
		},
	);

casesCmd
	.command("update")
	.argument("<app>", "App prefix or id")
	.argument("<number>", "Case number", (v) => Number(v))
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--title <title>", "New title")
	.option("--tag <tag>", "Replace tags with these (repeatable)", collect, [])
	.option("--flows-file <path>", "Path to a JSON array of flow steps (replaces all flows)")
	.option(
		"--script-file <path>",
		"Path to a Case Script file (.yoqa.yaml, or legacy .yoqa.json) to attach",
	)
	.option("--json", "Print raw JSON")
	.action(
		async (
			appArg: string,
			number: number,
			options: {
				baseUrl: string;
				title?: string;
				tag: string[];
				flowsFile?: string;
				scriptFile?: string;
				json?: boolean;
			},
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				const cases = await c.listCases(resolved.id);
				const found = cases.find((item) => item.number === number);
				if (!found) throw new Error(`Case #${number} not found`);
				const updated = await c.updateCase(found.id, {
					name: options.title,
					tags: options.tag.length > 0 ? options.tag : undefined,
					flows: options.flowsFile ? await loadUpdateCaseFlowsFile(options.flowsFile) : undefined,
					script: options.scriptFile
						? (await loadCaseScriptFile(options.scriptFile)).script
						: undefined,
				});
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

attachReportCommandOptions(
	program
		.command("report")
		.description("Export a detailed HTML or Markdown report with step screenshots"),
)
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (runId: string | undefined, options: ReportCommandOptions) => {
		await handleReportCommand("report", runId, options);
	});

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

attachReportCommandOptions(
	runsCmd
		.command("report")
		.description("Export a detailed HTML or Markdown report with step screenshots"),
)
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (runId: string | undefined, options: ReportCommandOptions) => {
		await handleReportCommand("runs report", runId, options);
	});

attachGithubOutputOptions(
	runsCmd
		.command("wait")
		.description("Wait until a catalog run finishes")
		.argument("<runId>", "Run id")
		.option(
			"--timeout <seconds>",
			"Wait timeout in seconds (default: 1800)",
			String(DEFAULT_RUN_WAIT_TIMEOUT_SECONDS),
		),
)
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.action(
		async (
			runId: string,
			options: {
				baseUrl: string;
				timeout?: string;
				githubOutput?: boolean;
				json?: boolean;
			},
		) => {
			try {
				const finished = await waitForRun(client(options.baseUrl), runId, {
					timeoutMs: parseTimeoutSeconds(options.timeout) * 1000,
					onStatus: createWaitStatusLogger(),
				});
				await maybeWriteGithubRunOutput(finished, options.githubOutput);
				if (options.json) {
					console.log(JSON.stringify(finished, null, 2));
				} else {
					console.log(`${finished.id} ${finished.status}`);
				}
				if (shouldFailOnRunStatus("errored", finished.status)) process.exitCode = 1;
			} catch (error) {
				if (error instanceof WaitForRunTimeoutError && error.lastRun) {
					await maybeWriteGithubRunOutput(error.lastRun, options.githubOutput);
				}
				fail("runs wait", error);
			}
		},
	);

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
	.option(
		"--platform <platform>",
		"ios | android | web (web for web-* and chromium-cdp-<port>; defaults to active session)",
	)
	.option("--build-id <id>", "Registered build id to install before run")
	.option("--build-path <path>", "Absolute build path to register + install")
	.option("--mode <mode>", "auto | script | agent (default: auto)")
	.option(
		"--screen-mode <mode>",
		"vision | tree — what the agent sees: screenshot only, or also the accessibility tree (default: vision)",
	)
	.option("--lane <lane>", "direct | auto")
	.option(
		"--record-video",
		"Record a screen video of every case in the run, even cases not set to record",
	)
	.option(
		"--profile <profile>",
		"web: kept | clean — the App's Kept browser profile or a throwaway one, whatever the cases ask (default: clean if a case asks, else kept)",
	)
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--wait", "Wait until the run finishes (passed / errored / cancelled)")
	.option(
		"--timeout <seconds>",
		"Wait timeout in seconds (default: 1800)",
		String(DEFAULT_RUN_WAIT_TIMEOUT_SECONDS),
	)
	.option("--github-output", "Write run_id and status to $GITHUB_OUTPUT")
	.option("--no-github-output", "Do not write GitHub step outputs")
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
				screenMode?: string;
				lane?: string;
				recordVideo?: boolean;
				profile?: string;
				json?: boolean;
				wait?: boolean;
				timeout?: string;
				githubOutput?: boolean;
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
				let platformOption =
					options.platform ?? (deviceId && isWebDeviceId(deviceId) ? "web" : undefined);
				if (!deviceId || !platformOption) {
					const active = await c.getActiveDevice();
					if (!active) {
						throw new Error(
							"No --device/--platform and no active session. Connect first or pass both flags.",
						);
					}
					// The user's own browser is never a Run's by default: only when --device names it.
					if (!deviceId && isEverydayDeviceId(active.deviceId)) {
						throw new Error(
							`The session is on your Everyday browser, which a Run uses only when named. Pass --device ${active.deviceId} to run there.`,
						);
					}
					deviceId = deviceId ?? active.deviceId;
					platformOption = platformOption ?? active.platform;
				}
				const platform = parsePlatform(platformOption);

				const executionMode =
					options.mode === "script" || options.mode === "agent" || options.mode === "auto"
						? options.mode
						: undefined;
				if (options.mode && !executionMode) {
					throw new Error("--mode must be auto, script, or agent");
				}

				const screenMode =
					options.screenMode === "vision" || options.screenMode === "tree"
						? options.screenMode
						: undefined;
				if (options.screenMode && !screenMode) {
					throw new Error("--screen-mode must be vision or tree");
				}

				const lane =
					options.lane === "direct" || options.lane === "auto" ? options.lane : undefined;
				if (options.lane && !lane) {
					throw new Error("--lane must be direct or auto");
				}

				const profile =
					options.profile === "kept" || options.profile === "clean" ? options.profile : undefined;
				if (options.profile && !profile) {
					throw new Error("--profile must be kept or clean");
				}

				let run = await c.createRun({
					appId: resolved.id,
					caseIds,
					deviceId,
					platform,
					buildId: options.buildId,
					buildPath: options.buildPath,
					executionMode,
					screenMode,
					lane,
					recordVideo: options.recordVideo || undefined,
					profile,
				});
				if (options.wait) {
					try {
						run = await waitForRun(c, run.id, {
							timeoutMs: parseTimeoutSeconds(options.timeout) * 1000,
							onStatus: createWaitStatusLogger(),
						});
					} catch (error) {
						if (error instanceof WaitForRunTimeoutError && error.lastRun) {
							await maybeWriteGithubRunOutput(error.lastRun, options.githubOutput);
						}
						throw error;
					}
				}
				await maybeWriteGithubRunOutput(run, options.githubOutput);
				if (options.json) {
					console.log(JSON.stringify(run, null, 2));
				} else {
					console.log(`created ${run.id} (${run.status})`);
					for (const test of run.tests) {
						if (test.recording?.status === "ready") {
							console.log(`video ${c.getRunTestVideoUrl(run.id, test.id)}`);
						} else if (test.recording?.status === "unavailable") {
							console.log(`video unavailable: ${test.recording.note ?? "unknown reason"}`);
						}
					}
				}
				if (options.wait && shouldFailOnRunStatus("errored", run.status)) {
					process.exitCode = 1;
				}
			} catch (error) {
				fail("runs create", error);
			}
		},
	);

// --- script (Case Script files) ---

const scriptCmd = program
	.command("script")
	.description("Validate, replay, and export Case Script files (*.yoqa.yaml)");

scriptCmd
	.command("validate")
	.argument("<file>", "Path to a Case Script file (.yoqa.yaml, or legacy .yoqa.json)")
	.option("--json", "Print the parsed Case Script, or the errors, as JSON")
	.description("Check a Case Script file without a runner or device")
	.action(async (file: string, options: { json?: boolean }) => {
		try {
			const parsed = parseCaseScriptFile(await readFile(file, "utf8"));
			if (options.json) {
				console.log(
					JSON.stringify(
						parsed.ok
							? { ok: true, name: parsed.name, script: parsed.script }
							: { ok: false, errors: parsed.errors },
						null,
						2,
					),
				);
			} else if (parsed.ok) {
				const count = parsed.script.actions.length;
				console.log(`ok ${file}: ${count} action${count === 1 ? "" : "s"}`);
			} else {
				console.error(`${file}:\n${formatCaseScriptFileErrors(parsed.errors)}`);
			}
			if (!parsed.ok) process.exitCode = 1;
		} catch (error) {
			fail("script validate", error);
		}
	});

scriptCmd
	.command("run")
	.argument("<file>", "Path to a Case Script file (.yoqa.yaml, or legacy .yoqa.json)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON per action")
	.description("Replay a Case Script file on the active device session")
	.action(async (file: string, options: { baseUrl: string; json?: boolean }) => {
		try {
			const { script } = await loadCaseScriptFile(file);
			const c = client(options.baseUrl);
			const active = await c.getActiveDevice();
			if (!active) {
				throw new Error("No active device session. Connect first: yoqa devices connect <id>");
			}

			const result = await runCaseScript(c, script, {
				pauseAfterActionMs: 800,
				onStep: (event) => {
					const { position, total, action, status, error, response, outcome } = event;
					if (status === "running") return;
					const step = position + 1;
					if (options.json) {
						console.log(
							JSON.stringify(
								{
									ok: status === "ok",
									status,
									type: action.type,
									step,
									path: event.path,
									command: caseScriptActionCommand(action),
									...(outcome ? { outcome } : {}),
									...(error ? { error } : {}),
									...(response ? { response } : {}),
								},
								null,
								2,
							),
						);
						return;
					}
					const line = formatCaseScriptReplayStep(event);
					if (status === "ok") console.log(`ok ${line} (${step}/${total})`);
					else if (status === "error") console.error(`error ${line} (${step}/${total}): ${error}`);
					else console.log(`skipped ${line} (${step}/${total})`);
				},
			});

			if (!result.ok) {
				const where = result.failedPath
					? formatCaseScriptStepPath(result.failedPath)
					: `action ${(result.failedIndex ?? 0) + 1}`;
				throw new Error(`${where} failed: ${result.error ?? "failed"}`);
			}
			if (!options.json) {
				console.log(`done ${result.total} step${result.total === 1 ? "" : "s"}`);
			}
		} catch (error) {
			fail("script run", error);
		}
	});

scriptCmd
	.command("export")
	.argument("<app>", "App prefix or id")
	.argument("<number>", "Case number", (v) => Number(v))
	.option("--format <format>", "yaml | shell", "yaml")
	.option("--out <file>", "Write to this file instead of stdout")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.description("Print or save a Test Case's Case Script as a Case Script file (or shell)")
	.action(
		async (
			appArg: string,
			number: number,
			options: { format: string; out?: string; baseUrl: string },
		) => {
			try {
				if (options.format !== "yaml" && options.format !== "shell") {
					throw new Error("--format must be yaml or shell");
				}
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				const cases = await c.listCases(resolved.id);
				const found = cases.find((item) => item.number === number);
				if (!found) throw new Error(`Case #${number} not found`);
				const detail = await c.getCase(found.id);
				if (!detail.script) throw new Error(`Case #${number} has no Case Script yet`);
				const text =
					options.format === "shell"
						? formatCaseScriptShell(detail.script, {
								caseNumber: detail.number,
								caseName: detail.name,
								appPrefix: resolved.prefix,
							})
						: formatCaseScriptFile(detail.script, { name: detail.name });
				if (options.out) {
					await writeFile(options.out, text, "utf8");
					console.log(`wrote ${options.out}`);
				} else {
					process.stdout.write(text);
				}
			} catch (error) {
				fail("script export", error);
			}
		},
	);

program
	.command("benchmark")
	.description("Compare Yoqa (and Argent, when installed) tap-to-result latency on one device")
	.requiredOption("--device <id>", "Device UDID / serial")
	.requiredOption("--platform <platform>", "ios | android")
	.option("--repeats <n>", "Tap-to-result repeats (default: suite repeats)", (v) => Number(v))
	.option("--suite <path>", "Versioned suite JSON (default: built-in v1)")
	.option("--tools <list>", "Comma-separated: yoqa,argent (default: yoqa)", "yoqa")
	.option("--lane <lane>", "Yoqa Lane: direct | auto", "auto")
	.option("--arms <list>", "Yoqa Screen arms: vision,tree (default: suite arms)")
	.option("--app <id>", "Catalog App id for Case arms (required when the suite has cases)")
	.option("--out <path>", "Write the JSON report to this path")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print JSON instead of the table")
	.action(
		async (options: {
			device: string;
			platform: string;
			repeats?: number;
			suite?: string;
			tools: string;
			lane: string;
			arms?: string;
			app?: string;
			out?: string;
			baseUrl: string;
			json?: boolean;
		}) => {
			try {
				const platform = parsePlatform(options.platform);
				if (platform === "web") throw new Error("benchmark runs on ios or android only");
				const lane =
					options.lane === "direct" || options.lane === "auto" ? options.lane : undefined;
				if (options.lane && !lane) throw new Error("--lane must be direct or auto");
				const suite = options.suite
					? parseBenchmarkSuite(JSON.parse(await readFile(options.suite, "utf8")))
					: DEFAULT_BENCHMARK_SUITE;
				const arms = options.arms
					? parseBenchmarkArms(options.arms.split(",").map((item) => item.trim()))
					: suite.arms;
				const repeats = options.repeats && options.repeats > 0 ? options.repeats : suite.repeats;
				const tools = options.tools.split(",").map((t) => t.trim());
				const c = client(options.baseUrl);
				const runs: LatencyRunInput[] = [];
				if (tools.includes("yoqa")) {
					for (const screenMode of arms) {
						runs.push(
							await runLatencyScenario(
								yoqaBenchmarkDriver(c, {
									deviceId: options.device,
									platform,
									lane,
									screenMode,
									appId: options.app,
								}),
								{ repeats, platform, suite, screenMode },
							),
						);
					}
				}
				if (tools.includes("argent")) {
					console.error("Argent driver: install the argent CLI and re-run; skipping for now.");
				}
				const report = summarizeLatency({
					recordedAt: new Date().toISOString(),
					repeats,
					suiteVersion: suite.version,
					runs,
				});
				const recommendation = recommendScreenDefault(
					report.results.find((row) => row.screenMode === "vision"),
					report.results.find((row) => row.screenMode === "tree"),
				);
				if (options.out) {
					await writeFile(
						options.out,
						`${JSON.stringify({ ...report, recommendation }, null, 2)}\n`,
					);
				}
				if (options.json) console.log(JSON.stringify({ ...report, recommendation }, null, 2));
				else {
					console.log(formatLatencyTable(report));
					if (arms.includes("tree")) {
						console.log(`default ${recommendation.screenMode} — ${recommendation.reason}`);
					}
				}
			} catch (error) {
				fail("benchmark", error);
			}
		},
	);

/** The fully built command tree. Exported so tests can introspect it without running the CLI. */
export function buildProgram(): Command {
	return program;
}
