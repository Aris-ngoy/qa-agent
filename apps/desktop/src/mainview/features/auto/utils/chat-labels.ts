import type { AutoChatProvider, AutoToolCall, ProviderKind } from "@yoqa/runner-client";

/** A chat's name in the picker; a chat the agent has not named yet is a "New chat". */
export function chatTitle(chat: { title: string }): string {
	return chat.title.trim() || "New chat";
}

/** The chat's Test Case as the header names it (`#8 Payout`); null when it has none. */
export function chatCaseLabel(chat: {
	caseId: string | null;
	caseNumber: number | null;
	caseName: string | null;
}): string | null {
	if (!chat.caseId) return null;
	const name = chat.caseName?.trim() ?? "";
	if (chat.caseNumber == null) return name || "Test case";
	return name ? `#${chat.caseNumber} ${name}` : `#${chat.caseNumber}`;
}

/** One choice in the composer's picker: a Provider and its model (null for its default). */
export type PickerOption = { key: string; label: string; providerId: string; model: string | null };

/** One Provider in the picker, with its models, or why it cannot chat now. */
export type PickerSection = {
	providerId: string;
	kind: ProviderKind;
	label: string;
	available: boolean;
	reason: string | null;
	options: PickerOption[];
};

/** The picker key for a Provider and model, and back. */
export function pickerKey(providerId: string, model: string | null): string {
	return JSON.stringify([providerId, model]);
}

export function pickFromKey(key: string): { providerId: string; model: string | null } | null {
	try {
		const parsed: unknown = JSON.parse(key);
		if (!Array.isArray(parsed) || typeof parsed[0] !== "string") return null;
		return { providerId: parsed[0], model: typeof parsed[1] === "string" ? parsed[1] : null };
	} catch {
		return null;
	}
}

function modelName(provider: AutoChatProvider, model: string): string {
	return provider.models.find((entry) => entry.id === model)?.name ?? model;
}

/**
 * The composer's picker: each Provider with its models, Default first (naming the model it
 * stands for), in the order the runner lists them. A Provider that cannot chat has none, and
 * keeps its reason. A chat model the list no longer has stays pickable under the chat's
 * Provider, so the picker never shows a blank selection.
 */
export function pickerSections(
	providers: AutoChatProvider[],
	chat: { providerId: string | null; model: string | null },
): PickerSection[] {
	return providers.map((provider) => {
		const options: PickerOption[] = [];
		if (provider.available) {
			const defaultName = provider.defaultModel ? modelName(provider, provider.defaultModel) : null;
			options.push({
				key: pickerKey(provider.id, null),
				label: defaultName ? `Default (${defaultName})` : "Default",
				providerId: provider.id,
				model: null,
			});
			for (const model of provider.models) {
				options.push({
					key: pickerKey(provider.id, model.id),
					label: model.name,
					providerId: provider.id,
					model: model.id,
				});
			}
			const own = chat.providerId === provider.id ? chat.model : null;
			if (own && !provider.models.some((model) => model.id === own)) {
				options.push({
					key: pickerKey(provider.id, own),
					label: own,
					providerId: provider.id,
					model: own,
				});
			}
		}
		return {
			providerId: provider.id,
			kind: provider.kind,
			label: provider.label,
			available: provider.available,
			reason: provider.reason,
			options,
		};
	});
}

/** Who answers the chat, as the picker shows it: `Claude · Opus`, or `Claude · Default`. */
export function chatAgentLabel(
	providers: AutoChatProvider[],
	chat: { providerId: string | null; model: string | null },
): string {
	const provider = providers.find((candidate) => candidate.id === chat.providerId);
	if (!provider) return "Pick a Provider";
	return `${provider.label} · ${chat.model ? modelName(provider, chat.model) : "Default"}`;
}

/**
 * Why the chat's Provider cannot answer its next message, asking for another; null while it
 * can. The runner says the same when a message is sent anyway.
 */
export function chatProviderProblem(
	providers: AutoChatProvider[],
	chat: { providerId: string | null },
): string | null {
	const pick = "in the picker below.";
	if (!chat.providerId) return `This chat has no Provider. Pick one ${pick}`;
	const provider = providers.find((candidate) => candidate.id === chat.providerId);
	if (!provider)
		return `The Provider this chat was on was removed or disabled. Pick another ${pick}`;
	if (provider.available) return null;
	return `${provider.label} cannot answer this chat: ${provider.reason ?? ""} Pick another ${pick}`;
}

/** A Yoqa tool's name as a reply shows it: `list_runs` (or `mcp__yoqa__list_runs`) reads "list runs". */
export function toolCallName(name: string): string {
	const bare = name.replace(/^mcp__.+?__/, "");
	return bare.replace(/[_-]+/g, " ").trim() || name;
}

export type ToolCallState = "running" | "failed" | "done";

export function toolCallState(call: Pick<AutoToolCall, "output" | "isError">): ToolCallState {
	if (call.output == null) return "running";
	return call.isError ? "failed" : "done";
}

/** The tool call's input on one line, for the row's summary; empty when it took none. */
export function toolCallInputText(input: unknown): string {
	if (input == null) return "";
	if (typeof input === "object" && Object.keys(input).length === 0) return "";
	try {
		return JSON.stringify(input) ?? "";
	} catch {
		return String(input);
	}
}
