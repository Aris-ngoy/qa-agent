import { z } from "zod";

export const healthResponseSchema = z.object({
	ok: z.literal(true),
	service: z.literal("yoqa-runner"),
	version: z.string(),
	uptimeMs: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const devicePlatformSchema = z.union([z.literal("ios"), z.literal("android")]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

export const deviceKindSchema = z.union([
	z.literal("physical"),
	z.literal("simulator"),
	z.literal("emulator"),
]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

export const deviceSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	/** User-facing device name (physical only), e.g. "Aristote's iPhone" */
	owner: z.string().optional(),
	osVersion: z.string().min(1),
	platform: devicePlatformSchema,
	kind: deviceKindSchema,
	/** Connection / boot state from the host tooling */
	state: z.string().optional(),
	model: z.string().optional(),
});

export type Device = z.infer<typeof deviceSchema>;

export const listDevicesResponseSchema = z.object({
	platform: devicePlatformSchema,
	devices: z.array(deviceSchema),
});

export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

export const appiumDriverSchema = z.union([z.literal("xcuitest"), z.literal("uiautomator2")]);
export type AppiumDriver = z.infer<typeof appiumDriverSchema>;

export const iosWdaActionSchema = z.union([
	z.literal("reused"),
	z.literal("reinstalled"),
	z.literal("built"),
]);

export type IosWdaAction = z.infer<typeof iosWdaActionSchema>;

export const setupPlatformRequestSchema = z.object({
	platform: devicePlatformSchema,
	deviceId: z.string().min(1).optional(),
	kind: deviceKindSchema.optional(),
	/** Absolute path to Xcode Contents/Developer (iOS physical) */
	xcodeDeveloperDir: z.string().min(1).optional(),
	/** Apple Development team ID (iOS physical) */
	developmentTeam: z.string().min(1).optional(),
	/** Full codesigning identity name, e.g. "Apple Development: …" (iOS physical) */
	codeSignIdentity: z.string().min(1).optional(),
	/** Force a full WebDriverAgent rebuild/install even when prep is reusable */
	force: z.boolean().optional(),
});

export type SetupPlatformRequest = z.infer<typeof setupPlatformRequestSchema>;

export const setupPlatformResponseSchema = z.object({
	ok: z.literal(true),
	platform: devicePlatformSchema,
	driver: appiumDriverSchema,
	appiumVersion: z.string().min(1),
	driverVersion: z.string().optional(),
	alreadyInstalled: z.boolean(),
	message: z.string().min(1),
	/** True when WebDriverAgent was ensured on a physical iOS device (any action) */
	wdaInstalled: z.boolean().optional(),
	/** Bundle ID of the installed WebDriverAgent runner */
	wdaBundleId: z.string().min(1).optional(),
	/** Whether WDA was reused, reinstalled from cache, or freshly built */
	wdaAction: iosWdaActionSchema.optional(),
});

export type SetupPlatformResponse = z.infer<typeof setupPlatformResponseSchema>;

export const setupPlatformErrorSchema = z.object({
	error: z.string().min(1),
	detail: z.string().optional(),
});

export type SetupPlatformError = z.infer<typeof setupPlatformErrorSchema>;

export const runtimeCheckIdSchema = z.union([
	z.literal("node"),
	z.literal("npm"),
	z.literal("appium"),
	z.literal("xcuitest"),
	z.literal("uiautomator2"),
	z.literal("xcode"),
	z.literal("adb"),
]);

export type RuntimeCheckId = z.infer<typeof runtimeCheckIdSchema>;

export const runtimeCheckSchema = z.object({
	id: runtimeCheckIdSchema,
	label: z.string().min(1),
	ok: z.boolean(),
	required: z.boolean(),
	detail: z.string().optional(),
});

export type RuntimeCheck = z.infer<typeof runtimeCheckSchema>;

export const runtimeStatusSchema = z.object({
	ready: z.boolean(),
	appiumVersion: z.string().optional(),
	appiumSource: z.union([z.literal("system"), z.literal("managed")]).optional(),
	checks: z.array(runtimeCheckSchema),
});

export type RuntimeStatus = z.infer<typeof runtimeStatusSchema>;

export const ensureRuntimeResponseSchema = z.object({
	ok: z.literal(true),
	ready: z.boolean(),
	status: runtimeStatusSchema,
	installed: z.array(setupPlatformResponseSchema),
	message: z.string().min(1),
});

export type EnsureRuntimeResponse = z.infer<typeof ensureRuntimeResponseSchema>;

// --- Catalog: apps / cases / flows / tags ---

export const capabilitySchema = z.object({
	id: z.string().min(1),
	key: z.string(),
	value: z.string(),
});

export type Capability = z.infer<typeof capabilitySchema>;

export const catalogAppSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	prefix: z.string().min(1),
	context: z.string(),
	iosBundleId: z.string(),
	iosAppStoreId: z.string(),
	androidApplicationId: z.string(),
	capabilities: z.array(capabilitySchema),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});

export type CatalogApp = z.infer<typeof catalogAppSchema>;

export const createAppRequestSchema = z.object({
	name: z.string().min(1),
	prefix: z.string().min(1).optional(),
});

export type CreateAppRequest = z.infer<typeof createAppRequestSchema>;

export const updateAppRequestSchema = z.object({
	name: z.string().min(1).optional(),
	prefix: z.string().min(1).optional(),
	context: z.string().optional(),
	iosBundleId: z.string().optional(),
	iosAppStoreId: z.string().optional(),
	androidApplicationId: z.string().optional(),
	capabilities: z.array(capabilitySchema).optional(),
});

export type UpdateAppRequest = z.infer<typeof updateAppRequestSchema>;

export const listAppsResponseSchema = z.object({
	apps: z.array(catalogAppSchema),
});

export type ListAppsResponse = z.infer<typeof listAppsResponseSchema>;

export const caseFlowStepSchema = z.object({
	id: z.string().min(1),
	instructions: z.string(),
	expectedResult: z.string(),
	flowId: z.string().min(1).nullable().optional(),
});

export type CaseFlowStep = z.infer<typeof caseFlowStepSchema>;

export const caseRunStatusSchema = z.union([z.literal("passed"), z.literal("errored")]);
export type CaseRunStatus = z.infer<typeof caseRunStatusSchema>;

export const caseScriptActionSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("tap"),
		x: z.number().min(0).max(1000),
		y: z.number().min(0).max(1000),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("type"),
		text: z.string(),
		reason: z.string().optional(),
	}),
	z.object({
		type: z.literal("wait"),
		ms: z.number().min(0).max(10_000),
		reason: z.string().optional(),
	}),
]);

export type CaseScriptAction = z.infer<typeof caseScriptActionSchema>;

export const caseScriptSchema = z.object({
	version: z.literal(1),
	sourceRunId: z.string().min(1).optional(),
	savedAt: z.number().int().nonnegative(),
	actions: z.array(caseScriptActionSchema).min(1),
});

export type CaseScript = z.infer<typeof caseScriptSchema>;

export const catalogCaseSchema = z.object({
	id: z.string().min(1),
	appId: z.string().min(1),
	number: z.number().int().positive(),
	name: z.string().min(1),
	tags: z.array(z.string()),
	flows: z.array(caseFlowStepSchema),
	capabilities: z.array(capabilitySchema),
	hasScript: z.boolean(),
	scriptSavedAt: z.number().int().nonnegative().nullable(),
	script: caseScriptSchema.nullable(),
	lastRunAt: z.number().int().nonnegative().nullable(),
	lastRunStatus: caseRunStatusSchema.nullable(),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});

export type CatalogCase = z.infer<typeof catalogCaseSchema>;

export const listCasesResponseSchema = z.object({
	cases: z.array(catalogCaseSchema),
});

export type ListCasesResponse = z.infer<typeof listCasesResponseSchema>;

export const createCaseRequestSchema = z.object({
	name: z.string().min(1),
	tags: z.array(z.string()).optional(),
	flows: z
		.array(
			z.object({
				instructions: z.string().optional(),
				expectedResult: z.string().optional(),
				flowId: z.string().min(1).nullable().optional(),
			}),
		)
		.optional(),
	capabilities: z.array(capabilitySchema).optional(),
});

export type CreateCaseRequest = z.infer<typeof createCaseRequestSchema>;

export const updateCaseRequestSchema = z.object({
	name: z.string().min(1).optional(),
	tags: z.array(z.string()).optional(),
	flows: z
		.array(
			z.object({
				id: z.string().min(1).optional(),
				instructions: z.string().optional(),
				expectedResult: z.string().optional(),
				flowId: z.string().min(1).nullable().optional(),
			}),
		)
		.optional(),
	capabilities: z.array(capabilitySchema).optional(),
});

export type UpdateCaseRequest = z.infer<typeof updateCaseRequestSchema>;

export const catalogFlowSchema = z.object({
	id: z.string().min(1),
	appId: z.string().min(1),
	name: z.string().min(1),
	instructions: z.string(),
	expectedResult: z.string(),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});

export type CatalogFlow = z.infer<typeof catalogFlowSchema>;

export const listFlowsResponseSchema = z.object({
	flows: z.array(catalogFlowSchema),
});

export type ListFlowsResponse = z.infer<typeof listFlowsResponseSchema>;

export const createFlowRequestSchema = z.object({
	name: z.string().min(1),
	instructions: z.string().optional(),
	expectedResult: z.string().optional(),
});

export type CreateFlowRequest = z.infer<typeof createFlowRequestSchema>;

export const updateFlowRequestSchema = z.object({
	name: z.string().min(1).optional(),
	instructions: z.string().optional(),
	expectedResult: z.string().optional(),
});

export type UpdateFlowRequest = z.infer<typeof updateFlowRequestSchema>;

export const catalogTagSchema = z.object({
	id: z.string().min(1),
	appId: z.string().min(1),
	name: z.string().min(1),
});

export type CatalogTag = z.infer<typeof catalogTagSchema>;

export const listTagsResponseSchema = z.object({
	tags: z.array(catalogTagSchema),
});

export type ListTagsResponse = z.infer<typeof listTagsResponseSchema>;

export const createTagRequestSchema = z.object({
	name: z.string().min(1),
});

export type CreateTagRequest = z.infer<typeof createTagRequestSchema>;

export const catalogErrorSchema = z.object({
	error: z.string().min(1),
	detail: z.string().optional(),
});

export type CatalogError = z.infer<typeof catalogErrorSchema>;

// --- AI providers ---

export const providerKindSchema = z.union([
	z.literal("anthropic"),
	z.literal("openai"),
	z.literal("claude"),
	z.literal("codex"),
	z.literal("opencode"),
	z.literal("github-copilot"),
	z.literal("groq"),
	z.literal("google"),
	z.literal("google-vertex"),
	z.literal("antigravity"),
	z.literal("cursor"),
	z.literal("grok"),
	z.literal("custom"),
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerAuthModeSchema = z.union([
	z.literal("api_key"),
	z.literal("cli"),
	z.literal("token"),
]);
export type ProviderAuthMode = z.infer<typeof providerAuthModeSchema>;

export const providerAccentColorSchema = z.union([
	z.literal("blue"),
	z.literal("royal"),
	z.literal("green"),
	z.literal("orange"),
	z.literal("red"),
	z.literal("purple"),
	z.literal("cyan"),
]);
export type ProviderAccentColor = z.infer<typeof providerAccentColorSchema>;

export const providerStatusSchema = z.union([
	z.literal("connected"),
	z.literal("invalid"),
	z.literal("unchecked"),
	z.literal("not_found"),
	z.literal("disabled"),
]);
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const aiProviderSchema = z.object({
	id: z.string().min(1),
	kind: providerKindSchema,
	label: z.string().min(1),
	authMode: providerAuthModeSchema,
	enabled: z.boolean(),
	binaryPath: z.string().nullable(),
	accentColor: providerAccentColorSchema,
	serverUrl: z.string().nullable(),
	baseUrl: z.string().nullable(),
	defaultModel: z.string().nullable(),
	isDefault: z.boolean(),
	apiKeyLast4: z.string().nullable(),
	envKeys: z.array(z.string()),
	status: providerStatusSchema,
	statusDetail: z.string().nullable(),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});

export type AiProvider = z.infer<typeof aiProviderSchema>;

export const listProvidersResponseSchema = z.object({
	providers: z.array(aiProviderSchema),
});

export type ListProvidersResponse = z.infer<typeof listProvidersResponseSchema>;

export const createProviderRequestSchema = z.object({
	kind: providerKindSchema,
	authMode: providerAuthModeSchema.optional(),
	apiKey: z.string().min(1).optional(),
	label: z.string().min(1).optional(),
	binaryPath: z.string().min(1).nullable().optional(),
	accentColor: providerAccentColorSchema.optional(),
	serverUrl: z.string().min(1).nullable().optional(),
	baseUrl: z.string().min(1).nullable().optional(),
	defaultModel: z.string().min(1).nullable().optional(),
	env: z.record(z.string(), z.string()).optional(),
	enabled: z.boolean().optional(),
	setAsDefault: z.boolean().optional(),
});

export type CreateProviderRequest = z.infer<typeof createProviderRequestSchema>;

export const updateProviderRequestSchema = z.object({
	apiKey: z.string().min(1).optional(),
	label: z.string().min(1).optional(),
	authMode: providerAuthModeSchema.optional(),
	binaryPath: z.string().min(1).nullable().optional(),
	accentColor: providerAccentColorSchema.optional(),
	serverUrl: z.string().min(1).nullable().optional(),
	baseUrl: z.string().min(1).nullable().optional(),
	defaultModel: z.string().min(1).nullable().optional(),
	env: z.record(z.string(), z.string()).nullable().optional(),
	enabled: z.boolean().optional(),
	setAsDefault: z.boolean().optional(),
	validate: z.boolean().optional(),
});

export type UpdateProviderRequest = z.infer<typeof updateProviderRequestSchema>;

export const validateProviderResponseSchema = z.object({
	ok: z.boolean(),
	provider: aiProviderSchema,
	message: z.string().min(1),
});

export type ValidateProviderResponse = z.infer<typeof validateProviderResponseSchema>;

export const probeProviderRequestSchema = z.object({
	kind: providerKindSchema,
	binaryPath: z.string().min(1).nullable().optional(),
});

export type ProbeProviderRequest = z.infer<typeof probeProviderRequestSchema>;

export const probeProviderResponseSchema = z.object({
	found: z.boolean(),
	version: z.string().nullable(),
	authenticated: z.boolean().nullable(),
	detail: z.string().min(1),
	binaryPath: z.string().nullable(),
});

export type ProbeProviderResponse = z.infer<typeof probeProviderResponseSchema>;

export const providerModelSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	tier: z.enum(["free", "paid"]).optional(),
});

export type ProviderModel = z.infer<typeof providerModelSchema>;

export const listProviderModelsResponseSchema = z.object({
	models: z.array(providerModelSchema),
	message: z.string(),
});

export type ListProviderModelsResponse = z.infer<typeof listProviderModelsResponseSchema>;

export const providerErrorSchema = z.object({
	error: z.string().min(1),
	detail: z.string().optional(),
});

export type ProviderError = z.infer<typeof providerErrorSchema>;

// --- Runs ---

export const runStatusSchema = z.union([
	z.literal("queued"),
	z.literal("running"),
	z.literal("passed"),
	z.literal("errored"),
	z.literal("cancelled"),
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const runTestStatusSchema = z.union([
	z.literal("queued"),
	z.literal("running"),
	z.literal("passed"),
	z.literal("errored"),
	z.literal("cancelled"),
]);
export type RunTestStatus = z.infer<typeof runTestStatusSchema>;

export const runExecutionModeSchema = z.union([
	z.literal("auto"),
	z.literal("script"),
	z.literal("agent"),
]);
export type RunExecutionMode = z.infer<typeof runExecutionModeSchema>;

export const createRunRequestSchema = z.object({
	appId: z.string().min(1),
	caseIds: z.array(z.string().min(1)).min(1),
	deviceId: z.string().min(1),
	platform: devicePlatformSchema,
	buildId: z.string().min(1).optional(),
	buildPath: z.string().min(1).optional(),
	/**
	 * How to execute cases:
	 * - `auto` (default): replay saved script when present, otherwise AI agent
	 * - `script`: prefer saved scripts (falls back to agent when a case has none)
	 * - `agent`: always use the AI agent
	 */
	executionMode: runExecutionModeSchema.optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const runStepSchema = z.object({
	id: z.string().min(1),
	runTestId: z.string().min(1),
	idx: z.number().int().nonnegative(),
	action: z.unknown(),
	screenshotUri: z.string().nullable(),
	ok: z.boolean(),
	latencyMs: z.number().nonnegative(),
	detail: z.string().nullable(),
	createdAt: z.number().int().nonnegative(),
});
export type RunStep = z.infer<typeof runStepSchema>;

export const runTestSchema = z.object({
	id: z.string().min(1),
	runId: z.string().min(1),
	caseId: z.string().min(1),
	status: runTestStatusSchema,
	executionMode: z
		.union([z.literal("script"), z.literal("agent")])
		.nullable()
		.optional(),
	error: z.string().nullable(),
	startedAt: z.number().int().nonnegative().nullable(),
	finishedAt: z.number().int().nonnegative().nullable(),
	steps: z.array(runStepSchema).optional(),
});
export type RunTest = z.infer<typeof runTestSchema>;

export const runSchema = z.object({
	id: z.string().min(1),
	appId: z.string().min(1),
	deviceId: z.string().min(1),
	platform: devicePlatformSchema,
	buildId: z.string().nullable(),
	status: runStatusSchema,
	executionMode: runExecutionModeSchema,
	error: z.string().nullable(),
	createdAt: z.number().int().nonnegative(),
	startedAt: z.number().int().nonnegative().nullable(),
	finishedAt: z.number().int().nonnegative().nullable(),
	tests: z.array(runTestSchema),
});
export type Run = z.infer<typeof runSchema>;

export const listRunsResponseSchema = z.object({
	runs: z.array(runSchema),
});
export type ListRunsResponse = z.infer<typeof listRunsResponseSchema>;

export const runErrorSchema = z.object({
	error: z.string().min(1),
	detail: z.string().optional(),
});
export type RunError = z.infer<typeof runErrorSchema>;

// --- Interactive device session / screen / action ---

export const connectDeviceRequestSchema = z.object({
	deviceId: z.string().min(1),
	platform: devicePlatformSchema,
	bundleId: z.string().min(1).optional(),
	appPackage: z.string().min(1).optional(),
});
export type ConnectDeviceRequest = z.infer<typeof connectDeviceRequestSchema>;

export const activeDeviceResponseSchema = z.object({
	deviceId: z.string().min(1),
	platform: devicePlatformSchema,
	connectedAt: z.number().int().nonnegative(),
});
export type ActiveDeviceResponse = z.infer<typeof activeDeviceResponseSchema>;

export const screenElementSchema = z.object({
	type: z.string(),
	label: z.string(),
	x: z.number(),
	y: z.number(),
	width: z.number(),
	height: z.number(),
	enabled: z.boolean().optional(),
	visible: z.boolean().optional(),
});
export type ScreenElement = z.infer<typeof screenElementSchema>;

export const screenResponseSchema = z.object({
	full: z.boolean(),
	window: z.object({ width: z.number(), height: z.number() }),
	elements: z.array(screenElementSchema).optional(),
	raw: z.string().optional(),
});
export type ScreenResponse = z.infer<typeof screenResponseSchema>;

export const screenshotRequestSchema = z.object({
	path: z.string().min(1).optional(),
});
export type ScreenshotRequest = z.infer<typeof screenshotRequestSchema>;

export const screenshotResponseSchema = z.object({
	path: z.string().min(1),
});
export type ScreenshotResponse = z.infer<typeof screenshotResponseSchema>;

export const actionKindSchema = z.union([
	z.literal("tap"),
	z.literal("swipe"),
	z.literal("drag"),
	z.literal("input"),
	z.literal("activate-app"),
	z.literal("terminate-app"),
	z.literal("restart-app"),
	z.literal("background-app"),
	z.literal("open-url"),
	z.literal("alert"),
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const actionRequestSchema = z.object({
	kind: actionKindSchema,
	x: z.number().optional(),
	y: z.number().optional(),
	x2: z.number().optional(),
	y2: z.number().optional(),
	durationMs: z.number().optional(),
	text: z.string().optional(),
	description: z.string().optional(),
	appId: z.string().optional(),
	url: z.string().optional(),
	alertAction: z.union([z.literal("accept"), z.literal("dismiss")]).optional(),
	seconds: z.number().optional(),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export const actionResponseSchema = z.object({
	ok: z.literal(true),
	kind: actionKindSchema,
	resolved: z
		.object({
			x: z.number().optional(),
			y: z.number().optional(),
		})
		.optional(),
});
export type ActionResponse = z.infer<typeof actionResponseSchema>;

export const yoqaStatusResponseSchema = z.object({
	runner: z.object({
		ok: z.boolean(),
		version: z.string().optional(),
	}),
	runtime: z.object({
		ready: z.boolean(),
	}),
	provider: z.object({
		configured: z.boolean(),
		kind: z.string().nullable(),
		label: z.string().nullable(),
	}),
	activeDevice: activeDeviceResponseSchema.nullable(),
});
export type YoqaStatusResponse = z.infer<typeof yoqaStatusResponseSchema>;

// --- Builds ---

export const buildPlatformSchema = z.union([
	z.literal("ios"),
	z.literal("android"),
	z.literal("unknown"),
]);
export type BuildPlatform = z.infer<typeof buildPlatformSchema>;

export const buildSchema = z.object({
	id: z.string().min(1),
	appId: z.string().nullable(),
	path: z.string().min(1),
	platform: buildPlatformSchema,
	name: z.string().min(1),
	bundleId: z.string().nullable(),
	version: z.string().nullable(),
	createdAt: z.number().int().nonnegative(),
});
export type Build = z.infer<typeof buildSchema>;

export const createBuildRequestSchema = z.object({
	path: z.string().min(1),
	appId: z.string().min(1).optional(),
	name: z.string().min(1).optional(),
});
export type CreateBuildRequest = z.infer<typeof createBuildRequestSchema>;

export const listBuildsResponseSchema = z.object({
	builds: z.array(buildSchema),
});
export type ListBuildsResponse = z.infer<typeof listBuildsResponseSchema>;
