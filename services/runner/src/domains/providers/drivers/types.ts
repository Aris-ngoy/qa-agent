import type { ProviderAuthMode, ProviderKind } from "@yoqa/runner-client";
import type { z } from "zod";

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
	/** OpenCode catalog group, e.g. "Amazon Bedrock" or "OpenCode Zen". */
	provider?: string;
	/** Known vision capability; absent = unknown (Settings must not warn). */
	vision?: boolean;
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

export type DriverCapabilities = {
	/** True when this adapter can run vision decide/ground for agent runs. */
	vision: boolean;
};

/** Runtime auth blob passed into vision completion (same fields as ActiveProviderAuth minus id). */
export type VisionAuth = {
	kind: ProviderKind;
	authMode: ProviderAuthMode;
	apiKey: string | null;
	baseUrl: string | null;
	serverUrl: string | null;
	defaultModel: string | null;
	binaryPath: string | null;
	env: Record<string, string>;
};

/** A screenshot prepared for a vision API (already resized/compressed). */
export type VisionImage = { base64: string; mediaType: "image/png" | "image/jpeg" };

/**
 * The user prompt of a vision call, split for the Prompt cache. `testCase` is the
 * Test Case block (stable for the whole Test Case); `step` is the per-step block.
 * SDK paths send: Test Case block, screenshot, step block.
 */
export type VisionPrompt = { testCase: string; step: string };

/**
 * Call usage for one HTTP attempt of a Decide or verify call. Each field is null
 * when the Provider did not report it. `inputTokens` is fresh (uncached) input.
 */
export type CallUsage = {
	inputTokens: number | null;
	cachedInputTokens: number | null;
	cacheWriteTokens: number | null;
	outputTokens: number | null;
};

export type VisionCompleteInput<T> = {
	auth: VisionAuth;
	schema: z.ZodType<T>;
	system: string;
	prompt: VisionPrompt;
	/** Raw screenshot (PNG base64). The adapter resizes before sending. */
	imageBase64: string;
	/** Pre-prepared image for this screenshot — reused across retries, skips re-prepare. */
	image?: VisionImage;
	/** Called when a completion is retried because the first reply was not usable JSON (provider JSON repair). */
	onDecideRetry?: () => void;
	/** Called once per HTTP attempt with its Call usage. SDK paths only; other paths never call it. */
	onUsage?: (usage: CallUsage) => void;
};

export type VisionPort = {
	completeObject: <T>(input: VisionCompleteInput<T>) => Promise<T>;
};

/** Serializable provider facts for Settings UI (logos stay in the desktop). */
export type DriverCatalogEntry = {
	kind: ProviderKind;
	label: string;
	description: string | null;
	authModes: ProviderAuthMode[];
	defaultBinary: string | null;
	envHints: string[];
	loginInstructions: string | null;
	capabilities: DriverCapabilities;
};

export type DriverDefinition = {
	kind: ProviderKind;
	label: string;
	/** Short product blurb for Settings catalog cards. */
	description?: string;
	defaultBinary: string | null;
	authModes: ProviderAuthMode[];
	envHints: string[];
	loginInstructions: string | null;
	capabilities: DriverCapabilities;
	/** Present iff `capabilities.vision` is true. */
	vision?: VisionPort;
	probe: (binaryPath?: string | null) => Promise<ProbeResult>;
	validate: (input: DriverValidateInput) => Promise<ValidateResult>;
	listModels: (input: DriverValidateInput) => Promise<ListModelsResult>;
};
