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
	MAX_SCREEN_ROWS,
	REMOTE_DEBUGGING_SETTING_URL,
	RunnerUnreachableError,
	type ServerEntry,
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
	formatDeviceState,
	formatViewportPreset,
	parseCaseScriptFile,
	parseKeyModifiers,
	parseKeyName,
	runCaseScript,
	screenCheckMissMessage,
	updateCaseFlowsSchema,
	waitForRun,
	webDeviceOf,
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
import { resetSessionCache, sessionIdOnce } from "./active-session";
import { emitAgentOutput, parseScreenLimit } from "./agent-output";
import { findCatalogApp } from "./catalog-app";
import {
	type JsonOptions,
	PRETTY_JSON_HELP,
	commandPath,
	emitDocument,
	emitJson,
	emitText,
} from "./command-output";
import { formatDoctorReport } from "./doctor-table";
import { formatEmittedUsage, resolveOutputBudget } from "./emitted-usage";
import { readEmittedUsage } from "./emitted-usage-ledger";
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
import { SKILL_NAME, formatSkillInstall, installSkill } from "./skill-install";

function runnerBaseUrl(): string {
	return runnerBaseUrlFromEnv();
}

const program = new Command();

program
	.name("yoqa")
	.description("Local Yoqa CLI (talks to the local runner over HTTP)")
	.version(packageJson.version)
	// The Device Session lookup is memoized for the command being run, not for the process: one
	// command can emit many times, but a reconnect between two commands must never be served the
	// previous session. In a real `yoqa` invocation those are the same thing; in the tests, which
	// run many commands in one process, they are not.
	.hook("preAction", resetSessionCache);

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
	// Only a request that got no answer means the runner may be down: an error the runner
	// answered with, or one the CLI raised itself, says nothing about it.
	if (error instanceof RunnerUnreachableError) {
		console.error("Is the runner up? Try: yoqa serve");
	}
	process.exitCode = 1;
}

program
	.command("serve")
	.description("Start the local Yoqa runner in the foreground (no desktop app required)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--stop", "Stop a runner previously started by yoqa (pid file)")
	.action(async (options: { baseUrl: string; stop?: boolean }, cmd: Command) => {
		try {
			if (options.stop) {
				const result = await stopOwnedRunner();
				await emitText(result.message, options, cmd);
				if (!result.ok) process.exitCode = 1;
				return;
			}
			const baseUrl = options.baseUrl;
			const health = await fetchRunnerHealth(baseUrl);
			if (health) {
				await emitText(`already running at ${baseUrl} (${health.version})`, options, cmd);
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
	if (commandChainIncludes(actionCommand, "skill")) return;
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
	cmd: Command,
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
			log: (message) => emitText(message, options, cmd),
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
	// No `--json`: this command has never printed anything else, so there is nothing to switch on.
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const health = await client(options.baseUrl).health();
			await emitJson(health, options, cmd);
		} catch (error) {
			fail("health", error);
		}
	});

program
	.command("status")
	.description("Show local runner, provider, and active device status")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const body = await client(options.baseUrl).getStatus();
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			const provider = body.provider.configured
				? `${body.provider.label ?? body.provider.kind ?? "configured"}`
				: "not configured";
			const device = body.activeDevice
				? `${body.activeDevice.platform} ${body.activeDevice.deviceId}`
				: "none";
			await emitText(
				[
					`runner: ${body.runner.ok ? "ok" : "down"}${body.runner.version ? ` (${body.runner.version})` : ""}`,
					`provider: ${provider}`,
					`active device: ${device}`,
				],
				options,
				cmd,
			);
		} catch (error) {
			fail("status", error);
		}
	});

// --- devices ---

const devices = program
	.command("devices")
	.description("List local devices, simulators, and emulators");

/** What to do about an Everyday browser that is not ready, by its state. */
const EVERYDAY_HINTS: Record<string, string> = {
	"remote debugging off": `Turn it on at ${REMOTE_DEBUGGING_SETTING_URL}, then connect`,
	"not running": `Open it, turn on remote debugging at ${REMOTE_DEBUGGING_SETTING_URL}, then connect`,
};

/** The device listing `yoqa devices <platform>` prints, a line per row. */
function devicesTableLines(
	devicesList: Array<{
		id: string;
		name: string;
		owner?: string;
		osVersion: string;
		kind: string;
		state?: string;
		unavailableReason?: string;
		verified?: boolean;
	}>,
): string[] {
	if (devicesList.length === 0) return ["No devices found."];
	const lines: string[] = [];
	for (const device of devicesList) {
		const label = device.owner ? `${device.name} (${device.owner})` : device.name;
		const stateLine = formatDeviceState(device);
		const state = stateLine ? ` [${stateLine}]` : "";
		lines.push(`${device.kind.padEnd(10)} ${label} — ${device.osVersion}${state}`);
		lines.push(`           ${device.id}`);
		if (device.unavailableReason) {
			lines.push(`           Not a target: ${device.unavailableReason}`);
		}
		const hint =
			webDeviceOf(device.id)?.kind === "everyday" ? EVERYDAY_HINTS[device.state ?? ""] : undefined;
		if (hint) lines.push(`           ${hint}`);
	}
	return lines;
}

const platformDevices = {} as Record<DevicePlatform, Command>;
for (const platform of Object.keys(PLATFORM_DEVICES_DESCRIPTION) as DevicePlatform[]) {
	platformDevices[platform] = devices
		.command(platform)
		.description(PLATFORM_DEVICES_DESCRIPTION[platform])
		.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
		.option("--json", "Print raw JSON")
		.option("--pretty", PRETTY_JSON_HELP)
		.option("--all", "Include unavailable / shutdown devices", true)
		.option("--booted-only", "Only show booted / online devices")
		.action(
			async (
				options: {
					baseUrl: string;
					all?: boolean;
					bootedOnly?: boolean;
				} & JsonOptions,
				cmd: Command,
			) => {
				try {
					const includeUnavailable = options.bootedOnly ? false : options.all !== false;
					const body = await client(options.baseUrl).listDevices(platform, {
						includeUnavailable,
					});
					if (options.json) {
						await emitJson(body, options, cmd);
						return;
					}
					await emitText(devicesTableLines(body.devices), options, cmd);
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
		const options = command.optsWithGlobals<
			{
				app?: string;
				browser?: string;
				baseUrl: string;
			} & JsonOptions
		>();
		try {
			const c = client(options.baseUrl);
			// A profile outlives its App, so an id the catalog no longer has is reset as given.
			const appId = options.app
				? (findCatalogApp(await c.listApps(), options.app)?.id ?? options.app)
				: undefined;
			const body = await c.resetWebProfile({ appId, browserId: options.browser });
			if (options.json) {
				await emitJson(body, options, command);
				return;
			}
			if (body.browserIds.length === 0) {
				const browser = options.browser ? ` in ${options.browser}` : "";
				await emitText(`No Kept profile for ${body.appId}${browser} to reset.`, options, command);
				return;
			}
			await emitText(
				`reset the Kept profile for ${body.appId} in ${body.browserIds.join(", ")}`,
				options,
				command,
			);
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
	.option("--pretty", PRETTY_JSON_HELP)
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
			} & JsonOptions,
			cmd: Command,
		) => {
			const web = webDeviceOf(deviceId);
			// The browser the Allow prompt appears in (`Google Chrome`), for an Everyday browser.
			const everyday = web?.kind === "everyday" ? web.browser.name : null;
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
					await emitJson(body, options, cmd);
					return;
				}
				await emitText(
					[
						`connected ${describeSession(body)}`,
						...(body.laneWarning ? [`lane warning: ${body.laneWarning}`] : []),
					],
					options,
					cmd,
				);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const body = await client(options.baseUrl).getActiveDevice();
			if (!body) {
				await emitText("No active device session.", options, cmd);
				process.exitCode = 1;
				return;
			}
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			await emitText(
				[describeSession(body), ...(body.laneWarning ? [`lane warning: ${body.laneWarning}`] : [])],
				options,
				cmd,
			);
		} catch (error) {
			fail("devices active", error);
		}
	});

devices
	.command("disconnect")
	.description("Close the active Device Session")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const body = await client(options.baseUrl).disconnectDevice();
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			await emitText(`disconnected ${body.platform} ${body.deviceId}`, options, cmd);
		} catch (error) {
			fail("devices disconnect", error);
		}
	});

// --- usage (what Yoqa has put into the calling agent's context) ---

program
	.command("usage")
	.description("Report Emitted usage for the active Device Session against the Output budget")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const session = await sessionIdOnce(options.baseUrl);
			const usage = session ? await readEmittedUsage(session) : null;
			const budget = resolveOutputBudget();
			if (options.json) {
				// One shape whether or not a session is connected, so an agent can parse it either way.
				const body = {
					session,
					total: usage?.total ?? 0,
					byCommand: usage?.byCommand ?? [],
					budget,
				};
				// Reading the meter costs the agent tokens too, so the meter counts it. The total
				// above was read before this line, so a report never includes itself.
				await emitJson(body, options, cmd);
				return;
			}
			// Accounted like the JSON report, and for the same reason: the total was read first.
			await emitText(formatEmittedUsage(usage, { budget }), options, cmd);
		} catch (error) {
			fail("usage", error);
		}
	});

// --- screen / screenshot / action ---

program
	.command("screen")
	.description("Inspect the active device screen (cleaned tree by default)")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--full", "Return the raw accessibility tree")
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.option(
		"--limit <rows>",
		`Cleaned-tree rows to print (default ${MAX_SCREEN_ROWS}, or YOQA_SCREEN_ROWS); the rest are counted, not printed`,
	)
	.action(
		async (
			options: {
				baseUrl: string;
				full?: boolean;
				limit?: string;
			} & JsonOptions,
			cmd: Command,
		) => {
			try {
				const limit = parseScreenLimit(options.limit);
				const screen = await client(options.baseUrl).getScreen({ full: options.full });
				await emitAgentOutput(
					{ kind: "screen", screen },
					{ json: options.json, pretty: options.pretty, limit },
					{ command: commandPath(cmd), session: () => sessionIdOnce(options.baseUrl) },
				);
			} catch (error) {
				fail("screen", error);
			}
		},
	);

program
	.command("screenshot")
	.description("Capture a screenshot from the active device")
	.argument("[path]", "Output PNG path")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (path: string | undefined, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
			try {
				const body = await client(options.baseUrl).takeScreenshot({ path });
				if (options.json) {
					await emitJson(body, options, cmd, body.path);
					return;
				}
				await emitText(body.path, options, cmd, body.path);
			} catch (error) {
				fail("screenshot", error);
			}
		},
	);

const action = program.command("action").description("Perform an action on the active device");

function addActionOptions(cmd: Command) {
	return cmd
		.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
		.option("--json", "Print raw JSON")
		.option("--pretty", PRETTY_JSON_HELP)
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

function resultScreenshotLines(shot: NonNullable<ActionResponse["screenshot"]>): string[] {
	return [
		`screenshot ${shot.path}`,
		...(shot.rawPath ? [`raw ${shot.rawPath}`] : []),
		...(shot.annotatedPath ? [`marked ${shot.annotatedPath}`] : []),
		`settled ${shot.settled} (${Math.round(shot.waitedMs)}ms)`,
		`changed ${shot.changed === null ? "unknown (screen still animating)" : shot.changed}`,
	];
}

function actionPhasesLine(phases: NonNullable<ActionResponse["phases"]>): string {
	return `phases capture=${phases.captureMs} action=${phases.actionMs} settle=${phases.settleMs}`;
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
	"reload-page",
] as const) {
	addActionOptions(action.command(kind).description(`Perform ${kind}`)).action(
		async (options: Record<string, unknown>, cmd: Command) => {
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
					await emitJson(body, options, cmd, body.screenshot?.path);
					return;
				}
				const lines = [`ok ${body.kind}`];
				if (body.resolved?.x != null && body.resolved?.y != null) {
					lines.push(`resolved ${body.resolved.x},${body.resolved.y}`);
				}
				if (body.screenshot) lines.push(...resultScreenshotLines(body.screenshot));
				if (body.phases) lines.push(actionPhasesLine(body.phases));
				await emitText(lines, options, cmd, body.screenshot?.path);
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
).action(async (options: Record<string, unknown>, cmd: Command) => {
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
			await emitJson(body, options, cmd, body.screenshot?.path);
			return;
		}
		const lines = [`ok ${body.kind}`];
		if (body.screenshot) lines.push(...resultScreenshotLines(body.screenshot));
		await emitText(lines, options, cmd, body.screenshot?.path);
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
).action(async (keyName: string, options: Record<string, unknown>, cmd: Command) => {
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
			await emitJson(body, options, cmd, body.screenshot?.path);
			return;
		}
		const lines = [`ok ${body.kind}`];
		if (body.screenshot) lines.push(...resultScreenshotLines(body.screenshot));
		if (body.phases) lines.push(actionPhasesLine(body.phases));
		await emitText(lines, options, cmd, body.screenshot?.path);
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
).action(async (file: string | undefined, options: Record<string, unknown>, cmd: Command) => {
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
			await emitJson(body, options, cmd, body.screenshot?.path);
			return;
		}
		const lines = [`batch ${body.ok ? "ok" : "failed"} ${body.completed}/${body.total}`];
		if (body.failedIndex != null) lines.push(`failedIndex ${body.failedIndex}`);
		if (body.error) lines.push(body.error);
		if (body.screenshot) lines.push(...resultScreenshotLines(body.screenshot));
		await emitText(lines, options, cmd, body.screenshot?.path);
		if (!body.ok) process.exitCode = 1;
	} catch (error) {
		fail("action batch", error);
	}
});

// --- servers / doctor ---

/** The table `yoqa servers` and `yoqa servers list` both print, a line per server. */
function serverTableLines(entries: ServerEntry[]): string[] {
	if (entries.length === 0) return ["No servers running"];
	return entries.map((entry) => {
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
		return `${entry.id}\t${entry.label}\t${meta}`;
	});
}

const servers = program
	.command("servers")
	.description("List or control the local runner and device sessions")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const body = await client(options.baseUrl).listServers();
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			await emitText(serverTableLines(body.servers), options, cmd);
		} catch (error) {
			fail("servers", error);
		}
	});

// --base-url, --json and --pretty are `servers`'s, which parses them wherever they are, so its
// subcommands read them from there rather than declaring copies commander never fills.
servers
	.command("list")
	.description("List running servers")
	.configureHelp({ showGlobalOptions: true })
	.action(async (_options: unknown, cmd: Command) => {
		const options = cmd.optsWithGlobals<{ baseUrl: string } & JsonOptions>();
		try {
			const body = await client(options.baseUrl).listServers();
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			await emitText(serverTableLines(body.servers), options, cmd);
		} catch (error) {
			fail("servers list", error);
		}
	});

servers
	.command("stop-all")
	.description("Disconnect the device session (does not stop the runner)")
	.configureHelp({ showGlobalOptions: true })
	.action(async (_options: unknown, cmd: Command) => {
		const options = cmd.optsWithGlobals<{ baseUrl: string } & JsonOptions>();
		try {
			const body = await client(options.baseUrl).stopAllServers();
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			await emitText(body.message, options, cmd);
		} catch (error) {
			fail("servers stop-all", error);
		}
	});

servers
	.command("stop")
	.description("Stop one server by id")
	.argument("<id>", "Server id from yoqa servers list")
	.configureHelp({ showGlobalOptions: true })
	.action(async (id: string, _options: unknown, cmd: Command) => {
		const options = cmd.optsWithGlobals<{ baseUrl: string } & JsonOptions>();
		try {
			if (id === "runner-self") {
				throw new Error(
					"Stopping the runner over HTTP is not supported. Quit the desktop app or kill the process on the runner port.",
				);
			}
			const body = await client(options.baseUrl).stopServer(id);
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			await emitText(body.message, options, cmd);
		} catch (error) {
			fail("servers stop", error);
		}
	});

servers
	.command("restart")
	.description("Restart one server by id")
	.argument("<id>", "Server id from yoqa servers list")
	.configureHelp({ showGlobalOptions: true })
	.action(async (id: string, _options: unknown, cmd: Command) => {
		const options = cmd.optsWithGlobals<{ baseUrl: string } & JsonOptions>();
		try {
			if (id === "runner-self") {
				throw new Error(
					"Restarting the runner over HTTP is not supported while it is serving requests. Prefer the desktop Servers panel.",
				);
			}
			const body = await client(options.baseUrl).restartServer(id);
			if (options.json) {
				await emitJson(body, options, cmd);
				return;
			}
			await emitText(body.message, options, cmd);
		} catch (error) {
			fail("servers restart", error);
		}
	});

program
	.command("doctor")
	.description("Diagnose local tooling and the device session")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.option("--fix", "Apply safe repairs (disconnect a stuck session)")
	.action(async (options: { baseUrl: string; fix?: boolean } & JsonOptions, cmd: Command) => {
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
						await emitJson({ ok: true, message: "No safe repairs", report }, options, cmd);
					} else {
						await emitText("No safe repairs to apply", options, cmd);
					}
					if (!report.ok) process.exitCode = 1;
					return;
				}
				const result = await c.repairDoctor({ repairs });
				if (options.json) {
					await emitJson(result, options, cmd);
				} else {
					await emitText([result.message, formatDoctorReport(result.report)], options, cmd);
				}
				if (!result.report.ok) process.exitCode = 1;
				return;
			}

			const report = await c.getDoctorReport();
			if (options.json) {
				await emitJson(report, options, cmd);
			} else {
				await emitText(formatDoctorReport(report), options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const status = await client(options.baseUrl).getIosSigning();
			if (options.json) await emitJson(status, options, cmd);
			else await emitText(formatSigningStatus(status), options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (team: string, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const status = await client(options.baseUrl).setIosSigningTeam(
				team.toLowerCase() === "auto" ? null : team,
			);
			if (options.json) await emitJson(status, options, cmd);
			else await emitText(formatSigningStatus(status), options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.option("--device <udid>", "iPhone UDID (default: the one cabled iPhone)")
	.action(async (options: { baseUrl: string; device?: string } & JsonOptions, cmd: Command) => {
		try {
			const c = client(options.baseUrl);
			const deviceId = pickCheckDevice(
				options.device,
				options.device ? [] : (await c.listDevices("ios")).devices,
			);
			if (!options.json) console.error(`Signing YoqaRunner for ${deviceId}…`);
			const check = await c.checkIosSigning({ deviceId });
			if (options.json) await emitJson(check, options, cmd);
			else await emitText(formatSigningCheck(check), options, cmd);
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
		.option("--pretty", PRETTY_JSON_HELP)
		.option("-t, --text <text>", "Text / label substring to match")
		.option("--id <id>", "Element id to match, as a tap by id does (instead of --text)")
		.option("--timeout <seconds>", "Seconds to wait before failing", (v) => Number(v), 5)
		.action(
			async (
				options: {
					baseUrl: string;
					text?: string;
					id?: string;
					timeout: number;
				} & JsonOptions,
				cmd: Command,
			) => {
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
						await emitJson({ ok: met, completed: met ? 1 : 0, total: 1, error }, options, cmd);
						return;
					}
					if (error) {
						console.error(`yoqa assert ${kind} failed: ${error}`);
						return;
					}
					await emitText(`ok assert ${kind}`, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const apps = await client(options.baseUrl).listApps();
			if (options.json) {
				await emitJson({ apps }, options, cmd);
				return;
			}
			await emitText(
				[`${"PREFIX".padEnd(20)}NAME`, ...apps.map((app) => `${app.prefix.padEnd(20)}${app.name}`)],
				options,
				cmd,
			);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			options: {
				baseUrl: string;
				name: string;
				prefix?: string;
				iosBundleId?: string;
				androidApplicationId?: string;
				webUrl?: string;
			} & JsonOptions,
			cmd: Command,
		) => {
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
					await emitJson(app, options, cmd);
					return;
				}
				await emitText(`created ${app.prefix}`, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (appArg: string, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const app = await c.getApp(resolved.id);
			if (options.json) {
				await emitJson(app, options, cmd);
				return;
			}
			await emitText(
				[
					`prefix: ${app.prefix}`,
					`name: ${app.name}`,
					`app_context: ${app.context || "(empty)"}`,
					`app_knowledge: ${app.knowledge || "(empty)"}`,
					`ios_bundle_id: ${app.iosBundleId || "(empty)"}`,
					`android_application_id: ${app.androidApplicationId || "(empty)"}`,
					`web_url: ${app.webUrl || "(empty)"}`,
				],
				options,
				cmd,
			);
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
	.option("--pretty", PRETTY_JSON_HELP)
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
			} & JsonOptions,
			cmd: Command,
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
					await emitJson(app, options, cmd);
					return;
				}
				await emitText(`updated ${app.prefix}`, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			appArg: string,
			options: { baseUrl: string; tag: string[] } & JsonOptions,
			cmd: Command,
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				let cases = await c.listCases(resolved.id);
				const tags = options.tag;
				if (tags.length > 0) {
					cases = cases.filter((item) => tags.every((tag) => item.tags.includes(tag)));
				}
				if (options.json) {
					await emitJson({ cases }, options, cmd);
					return;
				}
				await emitText(
					cases.map((item) => `#${item.number}  ${item.name}`),
					options,
					cmd,
				);
			} catch (error) {
				fail("cases list", error);
			}
		},
	);

casesCmd
	.command("get")
	.argument("<app>", "App prefix or id")
	.argument("<number>", "Case number", (v) => Number(v))
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			appArg: string,
			number: number,
			options: { baseUrl: string } & JsonOptions,
			cmd: Command,
		) => {
			try {
				const c = client(options.baseUrl);
				const resolved = await resolveAppId(c, appArg);
				const cases = await c.listCases(resolved.id);
				const found = cases.find((item) => item.number === number);
				if (!found) throw new Error(`Case #${number} not found`);
				const detail = await c.getCase(found.id);
				if (options.json) {
					await emitJson(detail, options, cmd);
					return;
				}
				const lines = [
					`#${detail.number} ${detail.name}`,
					`tags: ${detail.tags.join(", ") || "(none)"}`,
				];
				for (const step of detail.flows) {
					lines.push(`- ${step.instructions}`);
					if (step.expectedResult) lines.push(`  => ${step.expectedResult}`);
				}
				await emitText(lines, options, cmd);
			} catch (error) {
				fail("cases get", error);
			}
		},
	);

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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			appArg: string,
			options: {
				baseUrl: string;
				title: string;
				tag: string[];
				flowsFile?: string;
				scriptFile?: string;
			} & JsonOptions,
			cmd: Command,
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
					await emitJson(created, options, cmd);
					return;
				}
				await emitText(`created #${created.number} ${created.name}`, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
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
			} & JsonOptions,
			cmd: Command,
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
					await emitJson(updated, options, cmd);
					return;
				}
				await emitText(`updated #${updated.number}`, options, cmd);
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
	.action(async (appArg: string, number: number, options: { baseUrl: string }, cmd: Command) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const cases = await c.listCases(resolved.id);
			const found = cases.find((item) => item.number === number);
			if (!found) throw new Error(`Case #${number} not found`);
			await c.deleteCase(found.id);
			await emitText(`deleted #${number}`, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (appArg: string, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const flows = await c.listFlows(resolved.id);
			if (options.json) {
				await emitJson({ flows }, options, cmd);
				return;
			}
			await emitText(
				flows.map((flow) => `${flow.id}  ${flow.name}`),
				options,
				cmd,
			);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			appArg: string,
			flowId: string,
			options: { baseUrl: string } & JsonOptions,
			cmd: Command,
		) => {
			try {
				const c = client(options.baseUrl);
				await resolveAppId(c, appArg);
				const flow = await c.getFlow(flowId);
				if (options.json) {
					await emitJson(flow, options, cmd);
					return;
				}
				await emitText(
					[
						flow.name,
						flow.instructions,
						...(flow.expectedResult ? [`=> ${flow.expectedResult}`] : []),
					],
					options,
					cmd,
				);
			} catch (error) {
				fail("flows get", error);
			}
		},
	);

flowsCmd
	.command("create")
	.argument("<app>", "App prefix or id")
	.requiredOption("--name <name>", "Flow name")
	.option("--instructions <text>", "Instructions", "")
	.option("--result <text>", "Expected result", "")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			appArg: string,
			options: {
				baseUrl: string;
				name: string;
				instructions?: string;
				result?: string;
			} & JsonOptions,
			cmd: Command,
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
					await emitJson(flow, options, cmd);
					return;
				}
				await emitText(`created ${flow.id} ${flow.name}`, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			appArg: string,
			flowId: string,
			options: {
				baseUrl: string;
				name?: string;
				instructions?: string;
				result?: string;
			} & JsonOptions,
			cmd: Command,
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
					await emitJson(flow, options, cmd);
					return;
				}
				await emitText(`updated ${flow.id}`, options, cmd);
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
	.action(async (appArg: string, flowId: string, options: { baseUrl: string }, cmd: Command) => {
		try {
			const c = client(options.baseUrl);
			await resolveAppId(c, appArg);
			await c.deleteFlow(flowId);
			await emitText(`deleted ${flowId}`, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (appArg: string, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const tags = await c.listTags(resolved.id);
			if (options.json) {
				await emitJson({ tags }, options, cmd);
				return;
			}
			await emitText(
				tags.map((tag) => tag.name),
				options,
				cmd,
			);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			appArg: string | undefined,
			options: { baseUrl: string } & JsonOptions,
			cmd: Command,
		) => {
			try {
				const c = client(options.baseUrl);
				let appId: string | undefined;
				if (appArg) {
					appId = (await resolveAppId(c, appArg)).id;
				}
				const builds = await c.listBuilds(appId);
				if (options.json) {
					await emitJson({ builds }, options, cmd);
					return;
				}
				await emitText(
					builds.map(
						(build) => `${build.id}  ${build.platform.padEnd(8)} ${build.name}  ${build.path}`,
					),
					options,
					cmd,
				);
			} catch (error) {
				fail("builds list", error);
			}
		},
	);

buildsCmd
	.command("create")
	.argument("<path>", "Absolute path to .ipa / .app / .apk")
	.option("--app <app>", "App prefix or id")
	.option("--name <name>", "Display name")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			path: string,
			options: { baseUrl: string; app?: string; name?: string } & JsonOptions,
			cmd: Command,
		) => {
			try {
				const c = client(options.baseUrl);
				let appId: string | undefined;
				if (options.app) {
					appId = (await resolveAppId(c, options.app)).id;
				}
				const build = await c.createBuild({ path, appId, name: options.name });
				if (options.json) {
					await emitJson(build, options, cmd);
					return;
				}
				await emitText(`created ${build.id}`, options, cmd);
			} catch (error) {
				fail("builds create", error);
			}
		},
	);

buildsCmd
	.command("delete")
	.argument("<buildId>", "Build id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.action(async (buildId: string, options: { baseUrl: string }, cmd: Command) => {
		try {
			await client(options.baseUrl).deleteBuild(buildId);
			await emitText(`deleted ${buildId}`, options, cmd);
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
	.action(async (runId: string | undefined, options: ReportCommandOptions, cmd: Command) => {
		await handleReportCommand("report", runId, options, cmd);
	});

const runsCmd = program.command("runs").description("Create and inspect local agent runs");

runsCmd
	.command("list")
	.argument("<app>", "App prefix or id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (appArg: string, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const c = client(options.baseUrl);
			const resolved = await resolveAppId(c, appArg);
			const runs = await c.listRuns(resolved.id);
			if (options.json) {
				await emitJson({ runs }, options, cmd);
				return;
			}
			await emitText(
				runs.map((run) => `${run.id}  ${run.status.padEnd(10)} ${run.platform} ${run.deviceId}`),
				options,
				cmd,
			);
		} catch (error) {
			fail("runs list", error);
		}
	});

runsCmd
	.command("get")
	.argument("<runId>", "Run id")
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (runId: string, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const run = await client(options.baseUrl).getRun(runId);
			if (options.json) {
				await emitJson(run, options, cmd);
				return;
			}
			await emitText(
				[
					`${run.id} ${run.status}`,
					...run.tests.map(
						(test) => `  test ${test.caseId} ${test.status}${test.error ? ` — ${test.error}` : ""}`,
					),
				],
				options,
				cmd,
			);
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
	.action(async (runId: string | undefined, options: ReportCommandOptions, cmd: Command) => {
		await handleReportCommand("runs report", runId, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			runId: string,
			options: {
				baseUrl: string;
				timeout?: string;
				githubOutput?: boolean;
			} & JsonOptions,
			cmd: Command,
		) => {
			try {
				const finished = await waitForRun(client(options.baseUrl), runId, {
					timeoutMs: parseTimeoutSeconds(options.timeout) * 1000,
					onStatus: createWaitStatusLogger(),
				});
				await maybeWriteGithubRunOutput(finished, options.githubOutput);
				if (options.json) {
					await emitJson(finished, options, cmd);
				} else {
					await emitText(`${finished.id} ${finished.status}`, options, cmd);
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
	.action(async (runId: string, options: { baseUrl: string }, cmd: Command) => {
		try {
			await client(options.baseUrl).deleteRun(runId);
			await emitText(`deleted ${runId}`, options, cmd);
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
	.option(
		"--viewport <preset>",
		"web: desktop | mobile — reopens a session at another preset (default: the session's, else desktop)",
	)
	.option("--base-url <url>", "Runner base URL", runnerBaseUrl())
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
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
				viewport?: string;
				wait?: boolean;
				timeout?: string;
				githubOutput?: boolean;
			} & JsonOptions,
			cmd: Command,
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
					if (!deviceId && webDeviceOf(active.deviceId)?.kind === "everyday") {
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
				const viewport = parseViewportPreset(options.viewport, platform);

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
					viewport,
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
					await emitJson(run, options, cmd);
				} else {
					const lines = [`created ${run.id} (${run.status})`];
					for (const test of run.tests) {
						if (test.recording?.status === "ready") {
							lines.push(`video ${c.getRunTestVideoUrl(run.id, test.id)}`);
						} else if (test.recording?.status === "unavailable") {
							lines.push(`video unavailable: ${test.recording.note ?? "unknown reason"}`);
						}
					}
					await emitText(lines, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.description("Check a Case Script file without a runner or device")
	.action(async (file: string, options: JsonOptions, cmd: Command) => {
		try {
			const parsed = parseCaseScriptFile(await readFile(file, "utf8"));
			if (options.json) {
				await emitJson(
					parsed.ok
						? { ok: true, name: parsed.name, script: parsed.script }
						: { ok: false, errors: parsed.errors },
					options,
					cmd,
				);
			} else if (parsed.ok) {
				const count = parsed.script.actions.length;
				// Offline: no runner to ask for a Device Session, so this is written and not accounted.
				await emitText(`ok ${file}: ${count} action${count === 1 ? "" : "s"}`, {}, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.description("Replay a Case Script file on the active device session")
	.action(async (file: string, options: { baseUrl: string } & JsonOptions, cmd: Command) => {
		try {
			const { script } = await loadCaseScriptFile(file);
			const c = client(options.baseUrl);
			const active = await c.getActiveDevice();
			if (!active) {
				throw new Error("No active device session. Connect first: yoqa devices connect <id>");
			}

			const result = await runCaseScript(c, script, {
				pauseAfterActionMs: 800,
				// Async because each step's JSON goes through the output seam, which accounts for it.
				// `runCaseScript` awaits every `onStep`, so nothing here is fire-and-forget.
				onStep: async (event) => {
					const { position, total, action, status, error, response, outcome } = event;
					if (status === "running") return;
					const step = position + 1;
					if (options.json) {
						await emitJson(
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
							options,
							cmd,
						);
						return;
					}
					const line = formatCaseScriptReplayStep(event);
					if (status === "ok") await emitText(`ok ${line} (${step}/${total})`, options, cmd);
					else if (status === "error") console.error(`error ${line} (${step}/${total}): ${error}`);
					else await emitText(`skipped ${line} (${step}/${total})`, options, cmd);
				},
			});

			if (!result.ok) {
				const where = result.failedPath
					? formatCaseScriptStepPath(result.failedPath)
					: `action ${(result.failedIndex ?? 0) + 1}`;
				throw new Error(`${where} failed: ${result.error ?? "failed"}`);
			}
			if (!options.json) {
				await emitText(`done ${result.total} step${result.total === 1 ? "" : "s"}`, options, cmd);
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
			cmd: Command,
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
					await emitText(`wrote ${options.out}`, options, cmd);
				} else {
					await emitDocument(text, options, cmd);
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
	.option("--pretty", PRETTY_JSON_HELP)
	.action(
		async (
			options: {
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
			} & JsonOptions,
			cmd: Command,
		) => {
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
				if (options.json) await emitJson({ ...report, recommendation }, options, cmd);
				else {
					await emitText(
						[
							formatLatencyTable(report),
							...(arms.includes("tree")
								? [`default ${recommendation.screenMode} — ${recommendation.reason}`]
								: []),
						],
						options,
						cmd,
					);
				}
			} catch (error) {
				fail("benchmark", error);
			}
		},
	);

// --- skill (the agent skill this CLI carries) ---

program
	.command("skill")
	.description(`The ${SKILL_NAME} agent skill bundled in this CLI`)
	.command("install")
	.description(
		`Install the ${SKILL_NAME} skill for Claude Code, Cursor, Codex and other agents (no desktop app needed)`,
	)
	.option(
		"--dir <path>",
		`Write a plain copy to <path>/${SKILL_NAME} only, e.g. a project's .claude/skills`,
	)
	.option("--force", `Replace a ${SKILL_NAME} that yoqa did not install`)
	.option("--json", "Print raw JSON")
	.option("--pretty", PRETTY_JSON_HELP)
	.action(async (options: { dir?: string; force?: boolean } & JsonOptions, cmd: Command) => {
		try {
			const result = await installSkill({ dir: options.dir, force: options.force });
			if (options.json) await emitJson(result, options, cmd);
			// Offline, like `script validate`: written, and not accounted.
			else await emitText(formatSkillInstall(result), {}, cmd);
		} catch (error) {
			fail("skill install", error);
		}
	});

/** The fully built command tree. Exported so tests can introspect it without running the CLI. */
export function buildProgram(): Command {
	return program;
}
