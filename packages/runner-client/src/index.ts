import {
	type ActionRequest,
	type ActionResponse,
	type ActiveDeviceResponse,
	type AiProvider,
	type AppiumDriver,
	type Build,
	type Capability,
	type CaseFlowStep,
	type CaseRunStatus,
	type CaseScript,
	type CaseScriptAction,
	type CatalogApp,
	type CatalogCase,
	type CatalogError,
	type CatalogFlow,
	type CatalogTag,
	type ConnectDeviceRequest,
	type CreateAppRequest,
	type CreateBuildRequest,
	type CreateCaseRequest,
	type CreateFlowRequest,
	type CreateProviderRequest,
	type CreateRunRequest,
	type CreateTagRequest,
	type Device,
	type DeviceKind,
	type DevicePlatform,
	type EnsureRuntimeResponse,
	type HealthResponse,
	type IosWdaAction,
	type ListAppsResponse,
	type ListBuildsResponse,
	type ListCasesResponse,
	type ListDevicesResponse,
	type ListFlowsResponse,
	type ListProviderModelsResponse,
	type ListProvidersResponse,
	type ListRunsResponse,
	type ListTagsResponse,
	type ProbeProviderRequest,
	type ProbeProviderResponse,
	type ProviderAccentColor,
	type ProviderAuthMode,
	type ProviderError,
	type ProviderKind,
	type ProviderModel,
	type ProviderStatus,
	type Run,
	type RunError,
	type RunExecutionMode,
	type RunStatus,
	type RunStep,
	type RunTest,
	type RunTestStatus,
	type RuntimeCheck,
	type RuntimeStatus,
	type ScreenElement,
	type ScreenResponse,
	type ScreenshotRequest,
	type ScreenshotResponse,
	type SetupPlatformError,
	type SetupPlatformRequest,
	type SetupPlatformResponse,
	type UpdateAppRequest,
	type UpdateCaseRequest,
	type UpdateFlowRequest,
	type UpdateProviderRequest,
	type ValidateProviderResponse,
	type YoqaStatusResponse,
	actionRequestSchema,
	actionResponseSchema,
	activeDeviceResponseSchema,
	aiProviderSchema,
	appiumDriverSchema,
	buildSchema,
	capabilitySchema,
	caseFlowStepSchema,
	caseRunStatusSchema,
	caseScriptActionSchema,
	caseScriptSchema,
	catalogAppSchema,
	catalogCaseSchema,
	catalogErrorSchema,
	catalogFlowSchema,
	catalogTagSchema,
	connectDeviceRequestSchema,
	createAppRequestSchema,
	createBuildRequestSchema,
	createCaseRequestSchema,
	createFlowRequestSchema,
	createProviderRequestSchema,
	createRunRequestSchema,
	createTagRequestSchema,
	deviceKindSchema,
	devicePlatformSchema,
	deviceSchema,
	ensureRuntimeResponseSchema,
	healthResponseSchema,
	iosWdaActionSchema,
	listAppsResponseSchema,
	listBuildsResponseSchema,
	listCasesResponseSchema,
	listDevicesResponseSchema,
	listFlowsResponseSchema,
	listProviderModelsResponseSchema,
	listProvidersResponseSchema,
	listRunsResponseSchema,
	listTagsResponseSchema,
	probeProviderRequestSchema,
	probeProviderResponseSchema,
	providerAccentColorSchema,
	providerAuthModeSchema,
	providerErrorSchema,
	providerKindSchema,
	providerModelSchema,
	providerStatusSchema,
	runErrorSchema,
	runExecutionModeSchema,
	runSchema,
	runStatusSchema,
	runStepSchema,
	runTestSchema,
	runTestStatusSchema,
	runtimeCheckSchema,
	runtimeStatusSchema,
	screenResponseSchema,
	screenshotRequestSchema,
	screenshotResponseSchema,
	setupPlatformErrorSchema,
	setupPlatformRequestSchema,
	setupPlatformResponseSchema,
	updateAppRequestSchema,
	updateCaseRequestSchema,
	updateFlowRequestSchema,
	updateProviderRequestSchema,
	validateProviderResponseSchema,
	yoqaStatusResponseSchema,
} from "./schemas";

export {
	actionRequestSchema,
	actionResponseSchema,
	activeDeviceResponseSchema,
	aiProviderSchema,
	appiumDriverSchema,
	buildSchema,
	capabilitySchema,
	catalogAppSchema,
	catalogCaseSchema,
	catalogErrorSchema,
	catalogFlowSchema,
	catalogTagSchema,
	caseFlowStepSchema,
	caseRunStatusSchema,
	caseScriptActionSchema,
	caseScriptSchema,
	connectDeviceRequestSchema,
	createAppRequestSchema,
	createBuildRequestSchema,
	createCaseRequestSchema,
	createFlowRequestSchema,
	createProviderRequestSchema,
	createRunRequestSchema,
	createTagRequestSchema,
	deviceKindSchema,
	devicePlatformSchema,
	deviceSchema,
	ensureRuntimeResponseSchema,
	healthResponseSchema,
	listAppsResponseSchema,
	listBuildsResponseSchema,
	listCasesResponseSchema,
	listDevicesResponseSchema,
	listFlowsResponseSchema,
	listProviderModelsResponseSchema,
	listProvidersResponseSchema,
	listRunsResponseSchema,
	listTagsResponseSchema,
	probeProviderRequestSchema,
	probeProviderResponseSchema,
	providerAccentColorSchema,
	providerAuthModeSchema,
	providerErrorSchema,
	providerKindSchema,
	providerModelSchema,
	providerStatusSchema,
	runErrorSchema,
	runExecutionModeSchema,
	runSchema,
	runStatusSchema,
	runStepSchema,
	runTestSchema,
	runTestStatusSchema,
	runtimeCheckSchema,
	runtimeStatusSchema,
	screenResponseSchema,
	screenshotRequestSchema,
	screenshotResponseSchema,
	iosWdaActionSchema,
	setupPlatformErrorSchema,
	setupPlatformRequestSchema,
	setupPlatformResponseSchema,
	updateAppRequestSchema,
	updateCaseRequestSchema,
	updateFlowRequestSchema,
	updateProviderRequestSchema,
	validateProviderResponseSchema,
	yoqaStatusResponseSchema,
	type ActionRequest,
	type ActionResponse,
	type ActiveDeviceResponse,
	type AiProvider,
	type AppiumDriver,
	type Build,
	type Capability,
	type CatalogApp,
	type CatalogCase,
	type CatalogError,
	type CatalogFlow,
	type CatalogTag,
	type CaseFlowStep,
	type CaseRunStatus,
	type CaseScript,
	type CaseScriptAction,
	type ConnectDeviceRequest,
	type CreateAppRequest,
	type CreateBuildRequest,
	type CreateCaseRequest,
	type CreateFlowRequest,
	type CreateProviderRequest,
	type CreateRunRequest,
	type CreateTagRequest,
	type Device,
	type DeviceKind,
	type DevicePlatform,
	type EnsureRuntimeResponse,
	type HealthResponse,
	type IosWdaAction,
	type ListAppsResponse,
	type ListBuildsResponse,
	type ListCasesResponse,
	type ListDevicesResponse,
	type ListFlowsResponse,
	type ListProviderModelsResponse,
	type ListProvidersResponse,
	type ListRunsResponse,
	type ListTagsResponse,
	type ProbeProviderRequest,
	type ProbeProviderResponse,
	type ProviderAccentColor,
	type ProviderAuthMode,
	type ProviderError,
	type ProviderKind,
	type ProviderModel,
	type ProviderStatus,
	type Run,
	type RunError,
	type RunExecutionMode,
	type RunStatus,
	type RunStep,
	type RunTest,
	type RunTestStatus,
	type RuntimeCheck,
	type RuntimeStatus,
	type ScreenElement,
	type ScreenResponse,
	type ScreenshotRequest,
	type ScreenshotResponse,
	type SetupPlatformError,
	type SetupPlatformRequest,
	type SetupPlatformResponse,
	type UpdateAppRequest,
	type UpdateCaseRequest,
	type UpdateFlowRequest,
	type UpdateProviderRequest,
	type ValidateProviderResponse,
	type YoqaStatusResponse,
};

export {
	formatCaseScriptJson,
	formatCaseScriptShell,
	suggestedScriptBasename,
	type CaseScriptExportMeta,
} from "./script-format";

export {
	DEFAULT_SHELL_SCRIPT_HEADER,
	formatActionShellLine,
	formatSleepShellLine,
	parseYoqaShellScript,
	runYoqaShellScript,
	tokenizeShellLine,
	type ParseYoqaShellScriptResult,
	type RunYoqaShellScriptOptions,
	type ShellScriptActionStep,
	type ShellScriptSleepStep,
	type ShellScriptStep,
} from "./shell-script";

export type RunnerClientOptions = {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:7420";

function errorMessageFromBody(json: unknown, fallback: string): string {
	const parsedError = setupPlatformErrorSchema.safeParse(json);
	if (parsedError.success) {
		return parsedError.data.detail
			? `${parsedError.data.error}: ${parsedError.data.detail}`
			: parsedError.data.error;
	}
	const catalogError = catalogErrorSchema.safeParse(json);
	if (catalogError.success) {
		return catalogError.data.detail
			? `${catalogError.data.error}: ${catalogError.data.detail}`
			: catalogError.data.error;
	}
	const providerError = providerErrorSchema.safeParse(json);
	if (providerError.success) {
		return providerError.data.detail
			? `${providerError.data.error}: ${providerError.data.detail}`
			: providerError.data.error;
	}
	const runError = runErrorSchema.safeParse(json);
	if (runError.success) {
		return runError.data.detail
			? `${runError.data.error}: ${runError.data.detail}`
			: runError.data.error;
	}
	return fallback;
}

export class RunnerClient {
	readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: RunnerClientOptions = {}) {
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
		// Bind fetch — WebKit throws "Can only call Window.fetch on instances of Window"
		// when a detached fetch reference is invoked (e.g. Electrobun webview).
		this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
	}

	private async requestJson(
		path: string,
		init: RequestInit | undefined,
		fallbackError: string,
	): Promise<unknown> {
		const response = await this.fetchImpl(`${this.baseUrl}${path}`, init);
		const json: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(errorMessageFromBody(json, `${fallbackError}: HTTP ${response.status}`));
		}
		return json;
	}

	async health(): Promise<HealthResponse> {
		const response = await this.fetchImpl(`${this.baseUrl}/health`);
		if (!response.ok) {
			throw new Error(`Runner health failed: HTTP ${response.status}`);
		}
		const json: unknown = await response.json();
		return healthResponseSchema.parse(json);
	}

	async listDevices(
		platform: DevicePlatform,
		options: { includeUnavailable?: boolean } = {},
	): Promise<ListDevicesResponse> {
		const includeUnavailable = options.includeUnavailable ?? true;
		const params = new URLSearchParams({
			platform,
			all: includeUnavailable ? "1" : "0",
		});
		const response = await this.fetchImpl(`${this.baseUrl}/devices?${params.toString()}`);
		if (!response.ok) {
			throw new Error(`List devices failed: HTTP ${response.status}`);
		}
		const json: unknown = await response.json();
		return listDevicesResponseSchema.parse(json);
	}

	async listIosDevices(options?: { includeUnavailable?: boolean }): Promise<Device[]> {
		const result = await this.listDevices("ios", options);
		return result.devices.map((device) => deviceSchema.parse(device));
	}

	async listAndroidDevices(options?: { includeUnavailable?: boolean }): Promise<Device[]> {
		const result = await this.listDevices("android", options);
		return result.devices.map((device) => deviceSchema.parse(device));
	}

	async setupPlatform(
		request: SetupPlatformRequest | DevicePlatform,
		options: { signal?: AbortSignal } = {},
	): Promise<SetupPlatformResponse> {
		const body = setupPlatformRequestSchema.parse(
			typeof request === "string" ? { platform: request } : request,
		);
		const response = await this.fetchImpl(`${this.baseUrl}/devices/setup`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: options.signal,
		});

		const json: unknown = await response.json().catch(() => null);

		if (!response.ok) {
			throw new Error(errorMessageFromBody(json, `Setup platform failed: HTTP ${response.status}`));
		}

		return setupPlatformResponseSchema.parse(json);
	}

	async getRuntimeStatus(options: { signal?: AbortSignal } = {}): Promise<RuntimeStatus> {
		const response = await this.fetchImpl(`${this.baseUrl}/runtime`, {
			signal: options.signal,
		});
		const json: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(errorMessageFromBody(json, `Runtime status failed: HTTP ${response.status}`));
		}
		return runtimeStatusSchema.parse(json);
	}

	async ensureRuntime(options: { signal?: AbortSignal } = {}): Promise<EnsureRuntimeResponse> {
		const response = await this.fetchImpl(`${this.baseUrl}/runtime/ensure`, {
			method: "POST",
			signal: options.signal,
		});
		const json: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(errorMessageFromBody(json, `Ensure runtime failed: HTTP ${response.status}`));
		}
		return ensureRuntimeResponseSchema.parse(json);
	}

	async listApps(): Promise<CatalogApp[]> {
		const json = await this.requestJson("/apps", undefined, "List apps failed");
		return listAppsResponseSchema.parse(json).apps;
	}

	async getApp(appId: string): Promise<CatalogApp> {
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}`,
			undefined,
			"Get app failed",
		);
		return catalogAppSchema.parse(json);
	}

	async createApp(request: CreateAppRequest): Promise<CatalogApp> {
		const body = createAppRequestSchema.parse(request);
		const json = await this.requestJson(
			"/apps",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Create app failed",
		);
		return catalogAppSchema.parse(json);
	}

	async updateApp(appId: string, request: UpdateAppRequest): Promise<CatalogApp> {
		const body = updateAppRequestSchema.parse(request);
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Update app failed",
		);
		return catalogAppSchema.parse(json);
	}

	async deleteApp(appId: string): Promise<void> {
		await this.requestJson(
			`/apps/${encodeURIComponent(appId)}`,
			{ method: "DELETE" },
			"Delete app failed",
		);
	}

	async listCases(appId: string): Promise<CatalogCase[]> {
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}/cases`,
			undefined,
			"List cases failed",
		);
		return listCasesResponseSchema.parse(json).cases;
	}

	async getCase(caseId: string): Promise<CatalogCase> {
		const json = await this.requestJson(
			`/cases/${encodeURIComponent(caseId)}`,
			undefined,
			"Get case failed",
		);
		return catalogCaseSchema.parse(json);
	}

	async createCase(appId: string, request: CreateCaseRequest): Promise<CatalogCase> {
		const body = createCaseRequestSchema.parse(request);
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}/cases`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Create case failed",
		);
		return catalogCaseSchema.parse(json);
	}

	async updateCase(caseId: string, request: UpdateCaseRequest): Promise<CatalogCase> {
		const body = updateCaseRequestSchema.parse(request);
		const json = await this.requestJson(
			`/cases/${encodeURIComponent(caseId)}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Update case failed",
		);
		return catalogCaseSchema.parse(json);
	}

	async deleteCase(caseId: string): Promise<void> {
		await this.requestJson(
			`/cases/${encodeURIComponent(caseId)}`,
			{ method: "DELETE" },
			"Delete case failed",
		);
	}

	async listFlows(appId: string): Promise<CatalogFlow[]> {
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}/flows`,
			undefined,
			"List flows failed",
		);
		return listFlowsResponseSchema.parse(json).flows;
	}

	async createFlow(appId: string, request: CreateFlowRequest): Promise<CatalogFlow> {
		const body = createFlowRequestSchema.parse(request);
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}/flows`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Create flow failed",
		);
		return catalogFlowSchema.parse(json);
	}

	async updateFlow(flowId: string, request: UpdateFlowRequest): Promise<CatalogFlow> {
		const body = updateFlowRequestSchema.parse(request);
		const json = await this.requestJson(
			`/flows/${encodeURIComponent(flowId)}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Update flow failed",
		);
		return catalogFlowSchema.parse(json);
	}

	async deleteFlow(flowId: string): Promise<void> {
		await this.requestJson(
			`/flows/${encodeURIComponent(flowId)}`,
			{ method: "DELETE" },
			"Delete flow failed",
		);
	}

	async listTags(appId: string): Promise<CatalogTag[]> {
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}/tags`,
			undefined,
			"List tags failed",
		);
		return listTagsResponseSchema.parse(json).tags;
	}

	async createTag(appId: string, request: CreateTagRequest): Promise<CatalogTag> {
		const body = createTagRequestSchema.parse(request);
		const json = await this.requestJson(
			`/apps/${encodeURIComponent(appId)}/tags`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Create tag failed",
		);
		return catalogTagSchema.parse(json);
	}

	async deleteTag(tagId: string): Promise<void> {
		await this.requestJson(
			`/tags/${encodeURIComponent(tagId)}`,
			{ method: "DELETE" },
			"Delete tag failed",
		);
	}

	async listProviders(): Promise<AiProvider[]> {
		const json = await this.requestJson("/providers", undefined, "List providers failed");
		return listProvidersResponseSchema.parse(json).providers;
	}

	async getProvider(providerId: string): Promise<AiProvider> {
		const json = await this.requestJson(
			`/providers/${encodeURIComponent(providerId)}`,
			undefined,
			"Get provider failed",
		);
		return aiProviderSchema.parse(json);
	}

	async createProvider(request: CreateProviderRequest): Promise<AiProvider> {
		const body = createProviderRequestSchema.parse(request);
		const json = await this.requestJson(
			"/providers",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Create provider failed",
		);
		return aiProviderSchema.parse(json);
	}

	async updateProvider(providerId: string, request: UpdateProviderRequest): Promise<AiProvider> {
		const body = updateProviderRequestSchema.parse(request);
		const json = await this.requestJson(
			`/providers/${encodeURIComponent(providerId)}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Update provider failed",
		);
		return aiProviderSchema.parse(json);
	}

	async setDefaultProvider(providerId: string): Promise<AiProvider> {
		const json = await this.requestJson(
			`/providers/${encodeURIComponent(providerId)}/default`,
			{ method: "POST" },
			"Set default provider failed",
		);
		return aiProviderSchema.parse(json);
	}

	async validateProvider(providerId: string): Promise<ValidateProviderResponse> {
		const json = await this.requestJson(
			`/providers/${encodeURIComponent(providerId)}/validate`,
			{ method: "POST" },
			"Validate provider failed",
		);
		return validateProviderResponseSchema.parse(json);
	}

	async probeProvider(request: ProbeProviderRequest): Promise<ProbeProviderResponse> {
		const body = probeProviderRequestSchema.parse(request);
		const json = await this.requestJson(
			"/providers/probe",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Probe provider failed",
		);
		return probeProviderResponseSchema.parse(json);
	}

	async listProviderModels(providerId: string): Promise<ListProviderModelsResponse> {
		const json = await this.requestJson(
			`/providers/${encodeURIComponent(providerId)}/models`,
			undefined,
			"List provider models failed",
		);
		return listProviderModelsResponseSchema.parse(json);
	}

	async deleteProvider(providerId: string): Promise<void> {
		await this.requestJson(
			`/providers/${encodeURIComponent(providerId)}`,
			{ method: "DELETE" },
			"Delete provider failed",
		);
	}

	async createRun(request: CreateRunRequest): Promise<Run> {
		const body = createRunRequestSchema.parse(request);
		const json = await this.requestJson(
			"/runs",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Create run failed",
		);
		return runSchema.parse(json);
	}

	async listRuns(appId: string): Promise<Run[]> {
		const params = new URLSearchParams({ appId });
		const json = await this.requestJson(
			`/runs?${params.toString()}`,
			undefined,
			"List runs failed",
		);
		return listRunsResponseSchema.parse(json).runs;
	}

	async getRun(runId: string): Promise<Run> {
		const json = await this.requestJson(
			`/runs/${encodeURIComponent(runId)}`,
			undefined,
			"Get run failed",
		);
		return runSchema.parse(json);
	}

	async deleteRun(runId: string): Promise<void> {
		await this.requestJson(
			`/runs/${encodeURIComponent(runId)}`,
			{ method: "DELETE" },
			"Delete run failed",
		);
	}

	async cancelRun(runId: string): Promise<Run> {
		const json = await this.requestJson(
			`/runs/${encodeURIComponent(runId)}/cancel`,
			{ method: "POST" },
			"Cancel run failed",
		);
		return runSchema.parse(json);
	}

	getRunStepScreenshotUrl(runId: string, stepId: string): string {
		return `${this.baseUrl}/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepId)}/screenshot`;
	}

	async connectDevice(request: ConnectDeviceRequest): Promise<ActiveDeviceResponse> {
		const body = connectDeviceRequestSchema.parse(request);
		const json = await this.requestJson(
			"/devices/connect",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Connect device failed",
		);
		return activeDeviceResponseSchema.parse(json);
	}

	async getActiveDevice(): Promise<ActiveDeviceResponse | null> {
		const response = await this.fetchImpl(`${this.baseUrl}/devices/active`);
		if (response.status === 404) return null;
		const json: unknown = await response.json().catch(() => null);
		if (!response.ok) {
			throw new Error(
				errorMessageFromBody(json, `Get active device failed: HTTP ${response.status}`),
			);
		}
		return activeDeviceResponseSchema.parse(json);
	}

	async disconnectDevice(): Promise<ActiveDeviceResponse> {
		const json = await this.requestJson(
			"/devices/disconnect",
			{ method: "POST" },
			"Disconnect device failed",
		);
		return activeDeviceResponseSchema.parse(json);
	}

	async getScreen(options: { full?: boolean } = {}): Promise<ScreenResponse> {
		const params = new URLSearchParams();
		if (options.full) params.set("full", "1");
		const qs = params.toString();
		const json = await this.requestJson(
			`/screen${qs ? `?${qs}` : ""}`,
			undefined,
			"Get screen failed",
		);
		return screenResponseSchema.parse(json);
	}

	async takeScreenshot(request: ScreenshotRequest = {}): Promise<ScreenshotResponse> {
		const body = screenshotRequestSchema.parse(request);
		const json = await this.requestJson(
			"/screenshot",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Screenshot failed",
		);
		return screenshotResponseSchema.parse(json);
	}

	/** Live PNG from the active device session (for `<img src>` / blob fetch). */
	getScreenshotImageUrl(cacheBust?: number): string {
		const url = `${this.baseUrl}/screenshot/image`;
		return cacheBust != null ? `${url}?t=${cacheBust}` : url;
	}

	async fetchScreenshotBytes(): Promise<Uint8Array> {
		const response = await this.fetchImpl(`${this.baseUrl}/screenshot/image`);
		if (!response.ok) {
			const json: unknown = await response.json().catch(() => null);
			throw new Error(errorMessageFromBody(json, `Screenshot failed: HTTP ${response.status}`));
		}
		return new Uint8Array(await response.arrayBuffer());
	}

	async performAction(request: ActionRequest): Promise<ActionResponse> {
		const body = actionRequestSchema.parse(request);
		const json = await this.requestJson(
			"/action",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Action failed",
		);
		return actionResponseSchema.parse(json);
	}

	async getStatus(): Promise<YoqaStatusResponse> {
		const json = await this.requestJson("/status", undefined, "Status failed");
		return yoqaStatusResponseSchema.parse(json);
	}

	async listBuilds(appId?: string): Promise<Build[]> {
		const params = new URLSearchParams();
		if (appId) params.set("appId", appId);
		const qs = params.toString();
		const json = await this.requestJson(
			`/builds${qs ? `?${qs}` : ""}`,
			undefined,
			"List builds failed",
		);
		return listBuildsResponseSchema.parse(json).builds;
	}

	async createBuild(request: CreateBuildRequest): Promise<Build> {
		const body = createBuildRequestSchema.parse(request);
		const json = await this.requestJson(
			"/builds",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
			"Create build failed",
		);
		return buildSchema.parse(json);
	}

	async deleteBuild(buildId: string): Promise<void> {
		await this.requestJson(
			`/builds/${encodeURIComponent(buildId)}`,
			{ method: "DELETE" },
			"Delete build failed",
		);
	}

	async getFlow(flowId: string): Promise<CatalogFlow> {
		const json = await this.requestJson(
			`/flows/${encodeURIComponent(flowId)}`,
			undefined,
			"Get flow failed",
		);
		return catalogFlowSchema.parse(json);
	}
}

export function createRunnerClient(options?: RunnerClientOptions): RunnerClient {
	return new RunnerClient(options);
}
