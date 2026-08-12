import type { ProviderKind } from "@yoqa/runner-client";
import { anthropicDriver } from "./anthropic";
import { antigravityDriver } from "./antigravity";
import { claudeDriver } from "./claude";
import { codexDriver } from "./codex";
import { cursorDriver } from "./cursor";
import { customDriver } from "./custom";
import { githubCopilotDriver } from "./github-copilot";
import { googleDriver } from "./google";
import { googleVertexDriver } from "./google-vertex";
import { grokDriver } from "./grok";
import { groqDriver } from "./groq";
import { openaiDriver } from "./openai";
import { opencodeDriver } from "./opencode";
import type { DriverCatalogEntry, DriverDefinition } from "./types";

const DRIVERS: Record<ProviderKind, DriverDefinition> = {
	anthropic: anthropicDriver,
	openai: openaiDriver,
	claude: claudeDriver,
	codex: codexDriver,
	opencode: opencodeDriver,
	"github-copilot": githubCopilotDriver,
	groq: groqDriver,
	google: googleDriver,
	"google-vertex": googleVertexDriver,
	antigravity: antigravityDriver,
	cursor: cursorDriver,
	grok: grokDriver,
	custom: customDriver,
};

export function getDriver(kind: ProviderKind): DriverDefinition {
	return DRIVERS[kind];
}

export function listDrivers(): DriverDefinition[] {
	return Object.values(DRIVERS);
}

/** Product facts for Settings UI — logos remain desktop-owned. */
export function listDriverCatalog(): DriverCatalogEntry[] {
	return listDrivers().map((driver) => ({
		kind: driver.kind,
		label: driver.label,
		description: driver.description ?? null,
		authModes: driver.authModes,
		defaultBinary: driver.defaultBinary,
		envHints: driver.envHints,
		loginInstructions: driver.loginInstructions,
		capabilities: driver.capabilities,
	}));
}

export type {
	DriverCatalogEntry,
	DriverCapabilities,
	DriverDefinition,
	ProbeResult,
	ValidateResult,
	ListModelsResult,
} from "./types";
