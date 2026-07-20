export type RunnerSettings = {
	host: string;
	port: number;
	version: string;
};

export function loadSettings(): RunnerSettings {
	const port = Number(process.env.QA_AGENT_RUNNER_PORT ?? "7420");
	if (!Number.isFinite(port) || port <= 0) {
		throw new Error("QA_AGENT_RUNNER_PORT must be a positive number");
	}

	return {
		host: process.env.QA_AGENT_RUNNER_HOST ?? "127.0.0.1",
		port,
		version: process.env.QA_AGENT_RUNNER_VERSION ?? "0.1.0",
	};
}

export function runnerBaseUrl(settings: RunnerSettings = loadSettings()): string {
	return `http://${settings.host}:${settings.port}`;
}
