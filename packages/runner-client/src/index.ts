import { type HealthResponse, healthResponseSchema } from "./schemas";

export { healthResponseSchema, type HealthResponse };

export type RunnerClientOptions = {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:7420";

export class RunnerClient {
	readonly baseUrl: string;
	private readonly fetchImpl: typeof fetch;

	constructor(options: RunnerClientOptions = {}) {
		this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
		this.fetchImpl = options.fetchImpl ?? fetch;
	}

	async health(): Promise<HealthResponse> {
		const response = await this.fetchImpl(`${this.baseUrl}/health`);
		if (!response.ok) {
			throw new Error(`Runner health failed: HTTP ${response.status}`);
		}
		const json: unknown = await response.json();
		return healthResponseSchema.parse(json);
	}
}

export function createRunnerClient(options?: RunnerClientOptions): RunnerClient {
	return new RunnerClient(options);
}
