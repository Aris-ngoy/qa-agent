import type { ProviderAuthMode, ProviderKind } from "@yoqa/runner-client";

export type ProbeResult = {
	found: boolean;
	version: string | null;
	authenticated: boolean | null;
	detail: string;
	binaryPath: string | null;
};

export type ValidateResult = {
	ok: boolean;
	status: "connected" | "invalid" | "not_found";
	message: string;
};

export type ModelEntry = {
	id: string;
	name: string;
	tier?: "free" | "paid";
};

export type ListModelsResult = {
	models: ModelEntry[];
	message: string;
};

export type DriverValidateInput = {
	apiKey: string | null;
	baseUrl: string | null;
	serverUrl: string | null;
	binaryPath: string | null;
	env: Record<string, string>;
};

export type DriverDefinition = {
	kind: ProviderKind;
	label: string;
	defaultBinary: string | null;
	authModes: ProviderAuthMode[];
	envHints: string[];
	loginInstructions: string | null;
	probe: (binaryPath?: string | null) => Promise<ProbeResult>;
	validate: (input: DriverValidateInput) => Promise<ValidateResult>;
	listModels: (input: DriverValidateInput) => Promise<ListModelsResult>;
};
