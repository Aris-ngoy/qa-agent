import { z } from "zod";

export const healthResponseSchema = z.object({
	ok: z.literal(true),
	service: z.literal("yoqa-runner"),
	version: z.string(),
	uptimeMs: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const devicePlatformSchema = z.union([
	z.literal("ios"),
	z.literal("android"),
	z.literal("web"),
]);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

export const laneNameSchema = z.literal("direct");
export type LaneName = z.infer<typeof laneNameSchema>;

export const deviceKindSchema = z.union([
	z.literal("physical"),
	z.literal("simulator"),
	z.literal("emulator"),
	z.literal("browser"),
]);
export type DeviceKind = z.infer<typeof deviceKindSchema>;

/**
 * The page size a web Device Session emulates, chosen at connect and fixed for the
 * session's life (see `Viewport preset` in CONTEXT.md). `desktop` is the default.
 */
export const VIEWPORT_PRESET_NAMES = ["desktop", "mobile"] as const;
export const viewportPresetSchema = z.enum(VIEWPORT_PRESET_NAMES);
export type ViewportPresetName = z.infer<typeof viewportPresetSchema>;

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
	/** Why this device is listed but cannot be a target (e.g. an iPhone paired over Wi-Fi only). */
	unavailableReason: z.string().optional(),
});

export type Device = z.infer<typeof deviceSchema>;

export const listDevicesResponseSchema = z.object({
	platform: devicePlatformSchema,
	devices: z.array(deviceSchema),
});

export type ListDevicesResponse = z.infer<typeof listDevicesResponseSchema>;

export const runnerErrorSchema = z.object({
	error: z.string().min(1),
	detail: z.string().optional(),
});

export type RunnerError = z.infer<typeof runnerErrorSchema>;

// --- Servers lifecycle ---

export const serverKindSchema = z.union([z.literal("runner"), z.literal("device-session")]);
export type ServerKind = z.infer<typeof serverKindSchema>;

export const serverOwnershipSchema = z.union([
	z.literal("managed"),
	z.literal("foreign"),
	z.literal("self"),
]);
export type ServerOwnership = z.infer<typeof serverOwnershipSchema>;

export const serverActionSchema = z.union([z.literal("stop"), z.literal("restart")]);
export type ServerAction = z.infer<typeof serverActionSchema>;

export const serverEntrySchema = z.object({
	id: z.string().min(1),
	kind: serverKindSchema,
	ownership: serverOwnershipSchema,
	label: z.string().min(1),
	status: z.string().min(1),
	pid: z.number().int().positive().optional(),
	port: z.number().int().positive().optional(),
	deviceId: z.string().min(1).optional(),
	platform: devicePlatformSchema.optional(),
	startedAt: z.number().nonnegative().optional(),
	actions: z.array(serverActionSchema),
});
export type ServerEntry = z.infer<typeof serverEntrySchema>;

export const listServersResponseSchema = z.object({
	servers: z.array(serverEntrySchema),
});
export type ListServersResponse = z.infer<typeof listServersResponseSchema>;

export const serverMutationResponseSchema = z.object({
	ok: z.literal(true),
	message: z.string().min(1),
	servers: z.array(serverEntrySchema),
});
export type ServerMutationResponse = z.infer<typeof serverMutationResponseSchema>;

// --- Doctor diagnostics ---

export const doctorCheckStatusSchema = z.union([
	z.literal("pass"),
	z.literal("fail"),
	z.literal("warn"),
]);
export type DoctorCheckStatus = z.infer<typeof doctorCheckStatusSchema>;

export const doctorRepairIdSchema = z.literal("disconnect-session");
export type DoctorRepairId = z.infer<typeof doctorRepairIdSchema>;

export const doctorCheckSchema = z.object({
	id: z.string().min(1),
	label: z.string().min(1),
	status: doctorCheckStatusSchema,
	detail: z.string().optional(),
	fixHint: z.string().optional(),
});
export type DoctorCheck = z.infer<typeof doctorCheckSchema>;

export const doctorStepSchema = z.object({
	severity: z.union([z.literal("error"), z.literal("warn"), z.literal("info")]),
	title: z.string().min(1),
	detail: z.string().min(1),
	repair: doctorRepairIdSchema.optional(),
});
export type DoctorStep = z.infer<typeof doctorStepSchema>;

export const doctorReportSchema = z.object({
	ok: z.boolean(),
	checks: z.array(doctorCheckSchema),
	servers: z.array(serverEntrySchema),
	steps: z.array(doctorStepSchema),
});
export type DoctorReport = z.infer<typeof doctorReportSchema>;

export const doctorRepairRequestSchema = z.object({
	repairs: z.array(doctorRepairIdSchema).min(1),
});
export type DoctorRepairRequest = z.infer<typeof doctorRepairRequestSchema>;

export const doctorRepairResponseSchema = z.object({
	ok: z.literal(true),
	message: z.string().min(1),
	report: doctorReportSchema,
});
export type DoctorRepairResponse = z.infer<typeof doctorRepairResponseSchema>;

/** Where the physical-iOS signing team came from, highest precedence first. */
export const iosSigningSourceSchema = z.union([
	z.literal("env"),
	z.literal("saved"),
	z.literal("keychain"),
]);
export type IosSigningSource = z.infer<typeof iosSigningSourceSchema>;

/** A team this Mac can sign with: from Xcode › Accounts, the keychain, or both. */
export const iosSigningTeamSchema = z.object({
	id: z.string().min(1),
	/** Xcode's team name, else the certificate's common name. */
	name: z.string().nullable(),
	/** A free Personal Team (7-day profiles, 3 devices); null when Xcode did not say. */
	personal: z.boolean().nullable(),
	/** Signed in to Xcode › Settings › Accounts, so Xcode can make a certificate on this Mac. */
	inXcode: z.boolean(),
	/** The newest usable Apple Development certificate for the team on this Mac. */
	certificate: z
		.object({
			name: z.string().min(1),
			expiresAt: z.string().min(1),
		})
		.nullable(),
});
export type IosSigningTeam = z.infer<typeof iosSigningTeamSchema>;

export const iosSigningStatusSchema = z.object({
	/** The team the next YoqaRunner build signs with; null when there is none. */
	team: z.string().nullable(),
	source: iosSigningSourceSchema.nullable(),
	/** The team saved from Settings or `yoqa signing use`. */
	saved: z.string().nullable(),
	/** `YOQA_IOS_TEAM_ID` in the runner's environment; it wins over the saved team. */
	envOverride: z.string().nullable(),
	/** The App ID YoqaRunner is registered under for `team`. */
	bundleId: z.string().nullable(),
	teams: z.array(iosSigningTeamSchema),
});
export type IosSigningStatus = z.infer<typeof iosSigningStatusSchema>;

export const setIosSigningTeamRequestSchema = z.object({
	/** A ten-character team ID, or null to sign with the keychain's newest identity. */
	team: z.string().nullable(),
});
export type SetIosSigningTeamRequest = z.infer<typeof setIosSigningTeamRequestSchema>;

export const iosSigningCheckRequestSchema = z.object({
	deviceId: z.string().min(1),
});
export type IosSigningCheckRequest = z.infer<typeof iosSigningCheckRequestSchema>;

/** A real signed build for one iPhone; `ok: false` carries what to fix in `message`. */
export const iosSigningCheckResponseSchema = z.object({
	ok: z.boolean(),
	deviceId: z.string().min(1),
	team: z.string().nullable(),
	action: z.union([z.literal("built"), z.literal("reused")]).nullable(),
	profileExpiresAt: z.string().nullable(),
	/** The phones the profile lists, or null when it provisions all devices. */
	devices: z.array(z.string()).nullable(),
	message: z.string().min(1),
});
export type IosSigningCheckResponse = z.infer<typeof iosSigningCheckResponseSchema>;

/**
 * A connect that failed with HTTP 428: YoqaRunner is built and installed on the iPhone, but
 * the phone does not trust the free Personal Team's developer yet. Trust it, then reconnect.
 */
export const developerNotTrustedSchema = z.object({
	error: z.string(),
	code: z.literal("DEVELOPER_NOT_TRUSTED"),
	detail: z.string().min(1),
	team: z.string().min(1),
	/** What the phone lists under Developer App, e.g. "Apple Development: …"; null if unknown. */
	certificate: z.string().nullable(),
});
export type DeveloperNotTrusted = z.infer<typeof developerNotTrustedSchema>;

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
	/** App Knowledge: free-form notes about the app injected into agent decide context. */
	knowledge: z.string(),
	iosBundleId: z.string(),
	iosAppStoreId: z.string(),
	androidApplicationId: z.string(),
	/** Web URL: the page a Run on web opens, as iOS launches the bundle id. Empty when unset. */
	webUrl: z.string().default(""),
	capabilities: z.array(capabilitySchema),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});

export type CatalogApp = z.infer<typeof catalogAppSchema>;

export const createAppRequestSchema = z.object({
	name: z.string().min(1),
	prefix: z.string().min(1).optional(),
	/** A web-only App needs only a name and a Web URL. */
	webUrl: z.string().optional(),
});

export type CreateAppRequest = z.infer<typeof createAppRequestSchema>;

export const updateAppRequestSchema = z.object({
	name: z.string().min(1).optional(),
	prefix: z.string().min(1).optional(),
	context: z.string().optional(),
	knowledge: z.string().optional(),
	iosBundleId: z.string().optional(),
	iosAppStoreId: z.string().optional(),
	androidApplicationId: z.string().optional(),
	webUrl: z.string().optional(),
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

const caseScriptTapSchema = z
	.object({
		type: z.literal("tap"),
		x: z.number().min(0).max(1000).optional(),
		y: z.number().min(0).max(1000).optional(),
		/** Match a cleaned-tree element label (stable across screen sizes). */
		label: z.string().min(1).optional(),
		/** Match Android resource-id / iOS accessibility name. */
		id: z.string().min(1).optional(),
		double: z.boolean().optional(),
		durationMs: z.number().min(50).max(5_000).optional(),
		reason: z.string().optional(),
	})
	.superRefine((value, ctx) => {
		const hasCoords = value.x != null && value.y != null;
		if (!hasCoords && !value.label && !value.id) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "tap requires x/y or label or id",
			});
		}
	});

const caseScriptSwipeSchema = z.object({
	type: z.literal("swipe"),
	x: z.number().min(0).max(1000),
	y: z.number().min(0).max(1000),
	x2: z.number().min(0).max(1000),
	y2: z.number().min(0).max(1000),
	durationMs: z.number().min(50).max(5_000).optional(),
	reason: z.string().optional(),
});

const caseScriptDragSchema = z.object({
	type: z.literal("drag"),
	x: z.number().min(0).max(1000),
	y: z.number().min(0).max(1000),
	x2: z.number().min(0).max(1000),
	y2: z.number().min(0).max(1000),
	durationMs: z.number().min(50).max(5_000).optional(),
	reason: z.string().optional(),
});

/** The named keys a `key` Action can press (see `Action` in CONTEXT.md). */
export const KEY_NAMES = [
	"Enter",
	"Tab",
	"Escape",
	"Backspace",
	"Delete",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Home",
	"End",
	"PageUp",
	"PageDown",
	"Space",
] as const;
export const keyNameSchema = z.enum(KEY_NAMES);
export type KeyName = z.infer<typeof keyNameSchema>;

/** Modifiers held down while a `key` Action presses its key. */
export const KEY_MODIFIERS = ["Shift", "Control", "Alt", "Meta"] as const;
export const keyModifierSchema = z.enum(KEY_MODIFIERS);
export type KeyModifier = z.infer<typeof keyModifierSchema>;

function caseScriptAppIdSchema<T extends "activate-app" | "terminate-app" | "restart-app">(
	type: T,
) {
	return z.object({
		type: z.literal(type),
		appId: z.string().min(1),
		reason: z.string().optional(),
	});
}

const caseScriptTypeSchema = z.object({
	type: z.literal("type"),
	text: z.string(),
	reason: z.string().optional(),
});

const caseScriptWaitSchema = z.object({
	type: z.literal("wait"),
	ms: z.number().min(0).max(10_000),
	reason: z.string().optional(),
});

const caseScriptAssertionSchema = z
	.union([z.literal("visible"), z.literal("not-visible")])
	.default("visible");

const caseScriptAssertSchema = z.object({
	type: z.literal("assert"),
	assertion: caseScriptAssertionSchema,
	text: z.string().min(1),
	timeoutMs: z.number().min(0).max(120_000).optional(),
	reason: z.string().optional(),
});

const caseScriptAlertSchema = z.object({
	type: z.literal("alert"),
	alertAction: z.union([z.literal("accept"), z.literal("dismiss")]).default("accept"),
	reason: z.string().optional(),
});

const caseScriptBackgroundAppSchema = z.object({
	type: z.literal("background-app"),
	seconds: z.number().min(0).max(120).optional(),
	reason: z.string().optional(),
});

const caseScriptOpenUrlSchema = z.object({
	type: z.literal("open-url"),
	url: z.string().min(1),
	reason: z.string().optional(),
});

const caseScriptKeySchema = z.object({
	type: z.literal("key"),
	key: keyNameSchema,
	modifiers: z.array(keyModifierSchema).min(1).optional(),
	reason: z.string().optional(),
});

/** Every Case Script step that is an Action (everything but a Branch). */
const caseScriptGestureSchema = z.union([
	caseScriptTapSchema,
	caseScriptSwipeSchema,
	caseScriptDragSchema,
	caseScriptTypeSchema,
	caseScriptWaitSchema,
	caseScriptAssertSchema,
	caseScriptAlertSchema,
	caseScriptAppIdSchema("activate-app"),
	caseScriptAppIdSchema("terminate-app"),
	caseScriptAppIdSchema("restart-app"),
	caseScriptBackgroundAppSchema,
	caseScriptOpenUrlSchema,
	caseScriptKeySchema,
]);

/** Default wait of a Branch with no `timeoutMs`. */
export const BRANCH_DEFAULT_TIMEOUT_MS = 2_000;

/**
 * A Branch (see CONTEXT.md): checks the Screen, waiting up to `timeoutMs`, for one text or id,
 * and runs `then` when the check is met or `else` when it is not.
 */
export type CaseScriptBranch = {
	type: "branch";
	/** Exactly one of `text` (matched like `assert`) or `id` (matched like a tap by id). */
	text?: string;
	id?: string;
	assertion: "visible" | "not-visible";
	timeoutMs?: number;
	then: CaseScriptAction[];
	/** Never empty: an empty `else` reads as no `else`. */
	else?: CaseScriptAction[];
	reason?: string;
};

type CaseScriptBranchInput = Omit<CaseScriptBranch, "assertion" | "then" | "else"> & {
	assertion?: "visible" | "not-visible";
	then: CaseScriptActionInput[];
	else?: CaseScriptActionInput[];
};

/** A Case Script step: an Action, or a Branch holding more steps. */
export type CaseScriptAction = z.infer<typeof caseScriptGestureSchema> | CaseScriptBranch;
type CaseScriptActionInput = z.input<typeof caseScriptGestureSchema> | CaseScriptBranchInput;

type CaseScriptActionSchema = z.ZodType<CaseScriptAction, z.ZodTypeDef, CaseScriptActionInput>;

const caseScriptStepsSchema = z.array(z.lazy((): CaseScriptActionSchema => caseScriptActionSchema));

const caseScriptBranchSchema = z
	.object({
		type: z.literal("branch"),
		text: z.string().min(1).optional(),
		id: z.string().min(1).optional(),
		assertion: caseScriptAssertionSchema,
		timeoutMs: z.number().min(0).max(120_000).optional(),
		then: caseScriptStepsSchema.min(1),
		else: caseScriptStepsSchema
			.optional()
			.transform((actions) => (actions?.length ? actions : undefined)),
		reason: z.string().optional(),
	})
	.superRefine((value, ctx) => {
		if ((value.text == null) === (value.id == null)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "branch requires exactly one of text or id",
			});
		}
	});

export const caseScriptActionSchema: CaseScriptActionSchema = z.union([
	caseScriptGestureSchema,
	caseScriptBranchSchema,
]);

/** One schema per Case Script action type, so a Case Script file can report errors per action. */
export const caseScriptActionSchemaByType = {
	tap: caseScriptTapSchema,
	swipe: caseScriptSwipeSchema,
	drag: caseScriptDragSchema,
	type: caseScriptTypeSchema,
	wait: caseScriptWaitSchema,
	assert: caseScriptAssertSchema,
	alert: caseScriptAlertSchema,
	"activate-app": caseScriptAppIdSchema("activate-app"),
	"terminate-app": caseScriptAppIdSchema("terminate-app"),
	"restart-app": caseScriptAppIdSchema("restart-app"),
	"background-app": caseScriptBackgroundAppSchema,
	"open-url": caseScriptOpenUrlSchema,
	key: caseScriptKeySchema,
	branch: caseScriptBranchSchema,
} as const;

export type CaseScriptActionType = keyof typeof caseScriptActionSchemaByType;

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
	/** Record a screen video whenever this case runs. */
	recordVideo: z.boolean(),
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
	recordVideo: z.boolean().optional(),
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
	recordVideo: z.boolean().optional(),
	/** Set to replace the saved script; `null` clears it. */
	script: caseScriptSchema.nullable().optional(),
});

export type UpdateCaseRequest = z.infer<typeof updateCaseRequestSchema>;

/**
 * Flow steps as accepted by `cases create` / `cases update` — derived from the
 * request schemas so a `--flows-file` payload cannot drift from the API shape.
 * Strict: an unknown key (e.g. `result` instead of `expectedResult`) is an error,
 * not a silently dropped field.
 */
export const createCaseFlowsSchema = z.array(
	createCaseRequestSchema.shape.flows.unwrap().element.strict(),
);
export type CreateCaseFlows = z.infer<typeof createCaseFlowsSchema>;

export const updateCaseFlowsSchema = z.array(
	updateCaseRequestSchema.shape.flows.unwrap().element.strict(),
);
export type UpdateCaseFlows = z.infer<typeof updateCaseFlowsSchema>;

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

export const providerDriverCapabilitiesSchema = z.object({
	vision: z.boolean(),
});

export type ProviderDriverCapabilities = z.infer<typeof providerDriverCapabilitiesSchema>;

export const providerDriverCatalogEntrySchema = z.object({
	kind: providerKindSchema,
	label: z.string().min(1),
	description: z.string().nullable(),
	authModes: z.array(providerAuthModeSchema).min(1),
	defaultBinary: z.string().nullable(),
	envHints: z.array(z.string()),
	loginInstructions: z.string().nullable(),
	capabilities: providerDriverCapabilitiesSchema,
});

export type ProviderDriverCatalogEntry = z.infer<typeof providerDriverCatalogEntrySchema>;

export const listProviderCatalogResponseSchema = z.object({
	drivers: z.array(providerDriverCatalogEntrySchema),
});

export type ListProviderCatalogResponse = z.infer<typeof listProviderCatalogResponseSchema>;

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
	/** OpenCode catalog group, e.g. "Amazon Bedrock" or "OpenCode Zen". */
	provider: z.string().min(1).optional(),
	/** Known vision capability; absent = unknown (Settings must not warn). */
	vision: z.boolean().optional(),
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

/**
 * What the agent sees when it decides.
 * - `vision` (default): the screenshot and the instruction only; the agent names x,y.
 * - `tree`: also attaches the accessibility tree (Screen), so the agent can target by id.
 */
export const runScreenModeSchema = z.union([z.literal("vision"), z.literal("tree")]);
export type RunScreenMode = z.infer<typeof runScreenModeSchema>;

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
	/** Agent runs only. Omitted means `vision`. */
	screenMode: runScreenModeSchema.optional(),
	/** Lane override for the Device Session this Run opens. */
	lane: z.union([laneNameSchema, z.literal("auto")]).optional(),
	/** Record every case in this Run, whatever each case's own setting says. Omitted means off. */
	recordVideo: z.boolean().optional(),
});
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

/**
 * Call usage: tokens one Decide or verify call used. `inputTokens` is fresh
 * (uncached) input; `cachedInputTokens` were Prompt cache reads and `cacheWriteTokens`
 * Prompt cache writes. A field is null when the Provider did not report it.
 */
export const callUsageSchema = z.object({
	inputTokens: z.number().int().nonnegative().nullable(),
	cachedInputTokens: z.number().int().nonnegative().nullable(),
	cacheWriteTokens: z.number().int().nonnegative().nullable(),
	outputTokens: z.number().int().nonnegative().nullable(),
});
export type CallUsage = z.infer<typeof callUsageSchema>;

/** Per-phase wall-clock breakdown of one agent step (script steps leave it null). */
export const stepPhasesSchema = z.object({
	captureMs: z.number().nonnegative(),
	screenMs: z.number().nonnegative(),
	prepareMs: z.number().nonnegative(),
	decideMs: z.number().nonnegative(),
	actionMs: z.number().nonnegative(),
	settleMs: z.number().nonnegative(),
	/** Decide re-calls caused by JSON repair or an unusable first reply. */
	decideRetries: z.number().int().nonnegative(),
	/**
	 * Call usage summed over the step's Decide and verify calls. A field is null when
	 * no call reported it. Missing when no call reported usage (unavailable, not zero).
	 * Older steps never have it.
	 */
	usage: callUsageSchema.optional(),
});
export type StepPhases = z.infer<typeof stepPhasesSchema>;

export const runStepSchema = z.object({
	id: z.string().min(1),
	runTestId: z.string().min(1),
	idx: z.number().int().nonnegative(),
	action: z.unknown(),
	screenshotUri: z.string().nullable(),
	ok: z.boolean(),
	latencyMs: z.number().nonnegative(),
	phases: stepPhasesSchema.nullable().optional(),
	detail: z.string().nullable(),
	command: z.string().nullable().optional(),
	createdAt: z.number().int().nonnegative(),
});
export type RunStep = z.infer<typeof runStepSchema>;

/**
 * Recording state of one Test Case in a Run. `recording` while the case is running, `ready` once the video can be
 * played, `unavailable` when the Lane or device could not record (`note` says why).
 */
export const runRecordingSchema = z.object({
	status: z.union([z.literal("recording"), z.literal("ready"), z.literal("unavailable")]),
	note: z.string().min(1).optional(),
});
export type RunRecording = z.infer<typeof runRecordingSchema>;

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
	currentCommand: z.string().nullable().optional(),
	/** Present only when this case was recorded. */
	recording: runRecordingSchema.optional(),
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
	/** Runs from before Screen modes existed read back as `tree`, which is how they ran. */
	screenMode: runScreenModeSchema.optional(),
	lane: laneNameSchema.optional(),
	laneWarning: z.string().min(1).optional(),
	/** The browser a web Run drove, with its version (`Google Chrome 141.0`). */
	browser: z.string().min(1).optional(),
	/** The Viewport preset a web Run's session emulated. */
	viewport: viewportPresetSchema.optional(),
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
	lane: z.union([laneNameSchema, z.literal("auto")]).optional(),
	/** Web only: the Viewport preset the session emulates. Desktop when omitted. */
	viewport: viewportPresetSchema.optional(),
});
export type ConnectDeviceRequest = z.infer<typeof connectDeviceRequestSchema>;

/**
 * How the Inspector gets a Device Session's frames (its Frame Feed): `ready` is a live Stream;
 * `none` (the Lane has no stream) and `failed` (the stream did not answer) mean Screenshot Poll.
 */
export const streamStateSchema = z.union([
	z.literal("ready"),
	z.literal("none"),
	z.literal("failed"),
]);
export type StreamState = z.infer<typeof streamStateSchema>;

export const activeDeviceResponseSchema = z.object({
	deviceId: z.string().min(1),
	platform: devicePlatformSchema,
	connectedAt: z.number().int().nonnegative(),
	mjpegPort: z.number().int().positive().optional(),
	/** Compat: `streamState === "ready"`. */
	streamReady: z.boolean().optional(),
	streamState: streamStateSchema.optional(),
	/** Relative path on the runner (e.g. `/stream.mjpeg`). */
	streamUrl: z.string().min(1).optional(),
	/** A Run currently owns this session (interactive actions are view-only). */
	heldByRun: z.boolean().optional(),
	/** The id of the Run that holds this session, while one does. */
	heldByRunId: z.string().min(1).optional(),
	lane: laneNameSchema.optional(),
	laneWarning: z.string().min(1).optional(),
	/** The Viewport preset a web session emulates. Absent on other platforms. */
	viewport: viewportPresetSchema.optional(),
});
export type ActiveDeviceResponse = z.infer<typeof activeDeviceResponseSchema>;

/**
 * Point the Active Session at another app without reconnecting. The session uses the id
 * its platform needs: `bundleId` on iOS, `appPackage` on Android; a missing one forgets the app.
 */
export const retargetDeviceRequestSchema = z.object({
	bundleId: z.string().min(1).optional(),
	appPackage: z.string().min(1).optional(),
});
export type RetargetDeviceRequest = z.infer<typeof retargetDeviceRequestSchema>;

export const controlPointerMessageSchema = z.object({
	type: z.literal("pointer"),
	phase: z.union([z.literal("begin"), z.literal("move"), z.literal("end")]),
	x: z.number().min(0).max(1000),
	y: z.number().min(0).max(1000),
	seq: z.number().int().nonnegative(),
});
export type ControlPointerMessage = z.infer<typeof controlPointerMessageSchema>;

export const controlMessageSchema = controlPointerMessageSchema;
export type ControlMessage = z.infer<typeof controlMessageSchema>;

export const screenElementSchema = z.object({
	type: z.string(),
	label: z.string(),
	id: z.string().optional(),
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
	z.literal("key"),
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const actionRequestSchema = z.object({
	kind: actionKindSchema,
	x: z.number().optional(),
	y: z.number().optional(),
	x2: z.number().optional(),
	y2: z.number().optional(),
	durationMs: z.number().optional(),
	/** Double-tap when kind is tap. */
	double: z.boolean().optional(),
	text: z.string().optional(),
	/** Match a cleaned-tree element label and tap its center (screen-size independent). */
	label: z.string().min(1).optional(),
	/** Match Android resource-id / iOS accessibility name and tap its center. */
	id: z.string().min(1).optional(),
	description: z.string().optional(),
	appId: z.string().optional(),
	url: z.string().optional(),
	alertAction: z.union([z.literal("accept"), z.literal("dismiss")]).optional(),
	seconds: z.number().optional(),
	/** The key a `key` Action presses. */
	key: keyNameSchema.optional(),
	/** Held down while `key` is pressed. */
	modifiers: z.array(keyModifierSchema).optional(),
	/** Settle after the Action and return the Result screenshot. */
	screenshot: z.boolean().optional(),
	/** Cap, in ms, on how long to wait for the screen to settle (default 1500, max 10000). */
	settleMs: z.number().int().min(0).max(10_000).optional(),
	/** Return the raw Result screenshot instead of the Agent image. */
	fullImage: z.boolean().optional(),
	/** Scale the Agent image (0.01–1). Ignored when fullImage is set. */
	imageScale: z.number().min(0.01).max(1).optional(),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export const actionResultScreenshotSchema = z.object({
	/** Image handed to the caller (Agent image by default). */
	path: z.string().min(1),
	/** Raw Result screenshot kept as ground truth when `path` is a downscaled copy. */
	rawPath: z.string().min(1).optional(),
	/** Copy with a marker where a tap or swipe landed. Absent for Actions with no point. */
	annotatedPath: z.string().min(1).optional(),
	/** False when the screen was still changing at the cap (animation, games). */
	settled: z.boolean(),
	waitedMs: z.number(),
	/** Whether the screen differs from before the Action. Null when it never settled. */
	changed: z.boolean().nullable(),
});
export type ActionResultScreenshot = z.infer<typeof actionResultScreenshotSchema>;

export const actionPhasesSchema = z.object({
	/** Always 0 on the connector path — the previous Result fingerprint is reused. */
	captureMs: z.number().nonnegative(),
	actionMs: z.number().nonnegative(),
	settleMs: z.number().nonnegative(),
});
export type ActionPhases = z.infer<typeof actionPhasesSchema>;

export const actionResponseSchema = z.object({
	ok: z.literal(true),
	kind: actionKindSchema,
	resolved: z
		.object({
			x: z.number().optional(),
			y: z.number().optional(),
		})
		.optional(),
	screenshot: actionResultScreenshotSchema.optional(),
	phases: actionPhasesSchema.optional(),
});
export type ActionResponse = z.infer<typeof actionResponseSchema>;

export const actionBatchRequestSchema = z.object({
	steps: z.array(actionRequestSchema).min(1),
	settleMs: z.number().int().min(0).max(10_000).optional(),
	fullImage: z.boolean().optional(),
	imageScale: z.number().min(0.01).max(1).optional(),
});
export type ActionBatchRequest = z.infer<typeof actionBatchRequestSchema>;

export const actionBatchResponseSchema = z.object({
	ok: z.boolean(),
	completed: z.number().int().nonnegative(),
	total: z.number().int().nonnegative(),
	failedIndex: z.number().int().nonnegative().optional(),
	error: z.string().optional(),
	screenshot: actionResultScreenshotSchema.optional(),
	steps: z.array(actionResponseSchema),
});
export type ActionBatchResponse = z.infer<typeof actionBatchResponseSchema>;

export const yoqaStatusResponseSchema = z.object({
	runner: z.object({
		ok: z.boolean(),
		version: z.string().optional(),
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
