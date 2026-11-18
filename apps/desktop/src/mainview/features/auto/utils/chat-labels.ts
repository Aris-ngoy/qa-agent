import type { AutoModel, AutoToolCall } from "@yoqa/runner-client";

/** The model picker's key for "the Claude Provider's default" (a chat `model` of null). */
export const DEFAULT_MODEL_KEY = "default";

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

export type ModelOption = { id: string; label: string };

/**
 * The composer's model picker: Default first (naming the model it stands for when the Provider
 * says), then the Provider's models. A chat model the list no longer has stays pickable, so the
 * picker never shows a blank selection.
 */
export function modelOptions(
	models: AutoModel[],
	defaultModel: string | null,
	chatModel: string | null,
): ModelOption[] {
	const defaultName = defaultModel
		? (models.find((model) => model.id === defaultModel)?.name ?? defaultModel)
		: null;
	const options: ModelOption[] = [
		{ id: DEFAULT_MODEL_KEY, label: defaultName ? `Default (${defaultName})` : "Default" },
		...models.map((model) => ({ id: model.id, label: model.name })),
	];
	if (chatModel && !models.some((model) => model.id === chatModel)) {
		options.push({ id: chatModel, label: chatModel });
	}
	return options;
}

/** The picker key for a chat's `model`, and back. */
export function modelKey(model: string | null): string {
	return model ?? DEFAULT_MODEL_KEY;
}

export function modelFromKey(key: string): string | null {
	return key === DEFAULT_MODEL_KEY ? null : key;
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
