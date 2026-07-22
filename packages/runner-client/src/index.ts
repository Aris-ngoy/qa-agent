import {
	type AppiumDriver,
	type Device,
	type DeviceKind,
	type DevicePlatform,
	type EnsureRuntimeResponse,
	type HealthResponse,
	type ListDevicesResponse,
	type RuntimeCheck,
	type RuntimeStatus,
	type SetupPlatformError,
	type SetupPlatformRequest,
	type SetupPlatformResponse,
	appiumDriverSchema,
	deviceKindSchema,
	devicePlatformSchema,
	deviceSchema,
	ensureRuntimeResponseSchema,
	healthResponseSchema,
	listDevicesResponseSchema,
	runtimeCheckSchema,
	runtimeStatusSchema,
	setupPlatformErrorSchema,
	setupPlatformRequestSchema,
	setupPlatformResponseSchema,
} from "./schemas";

export {
	appiumDriverSchema,
	deviceKindSchema,
	devicePlatformSchema,
	deviceSchema,
	ensureRuntimeResponseSchema,
	healthResponseSchema,
	listDevicesResponseSchema,
	runtimeCheckSchema,
	runtimeStatusSchema,
	setupPlatformErrorSchema,
	setupPlatformRequestSchema,
	setupPlatformResponseSchema,
	type AppiumDriver,
	type Device,
	type DeviceKind,
	type DevicePlatform,
	type EnsureRuntimeResponse,
	type HealthResponse,
	type ListDevicesResponse,
	type RuntimeCheck,
	type RuntimeStatus,
	type SetupPlatformError,
	type SetupPlatformRequest,
	type SetupPlatformResponse,
};

export type RunnerClientOptions = {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:7420";

function errorMessageFromBody(json: unknown, fallback: string): string {
	const parsedError = setupPlatformErrorSchema.safeParse(json);
	if (!parsedError.success) return fallback;
	return parsedError.data.detail
		? `${parsedError.data.error}: ${parsedError.data.detail}`
		: parsedError.data.error;
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
		platform: DevicePlatform,
		options: { signal?: AbortSignal } = {},
	): Promise<SetupPlatformResponse> {
		const body = setupPlatformRequestSchema.parse({ platform });
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
}

export function createRunnerClient(options?: RunnerClientOptions): RunnerClient {
	return new RunnerClient(options);
}
