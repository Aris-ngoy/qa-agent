import type { InspectorSelection } from "@/features/inspector/selection";
import {
	type ActionRequest,
	formatActionShellLine,
	formatAssertShellLine,
	formatSleepShellLine,
} from "@yoqa/runner-client";

export type SnippetCommandId =
	| "tap"
	| "tapPoint"
	| "doubleTap"
	| "longPress"
	| "assertVisible"
	| "assertNotVisible"
	| "inputText"
	| "wait"
	| "activateApp"
	| "terminateApp"
	| "restartApp"
	| "openUrl"
	| "acceptAlert"
	| "dismissAlert";

export type SnippetContext = {
	defaultAppId: string;
};

export type CommandSnippet = {
	id: SnippetCommandId;
	/** Short label for selector-commands list. */
	label: string;
	/** Monospace preview lines shown in the menu. */
	previewLines: string[];
	/** True when the user must supply a value before insert. */
	needsPrompt: "text" | "seconds" | null;
	/** Hint for the prompt field (app id / url / wait). */
	promptKind?: "appId" | "url" | "seconds" | "text";
};

const LONG_PRESS_MS = 2000;
const DEFAULT_ASSERT_TIMEOUT = 5;
const DEFAULT_WAIT_SECONDS = 1;
const INPUT_PLACEHOLDER = "…";
const APP_ID_PLACEHOLDER = "com.example.app";
const URL_PLACEHOLDER = "myapp://path";

const EDITABLE_TYPE_RE =
	/(textfield|edittext|searchfield|securetextfield|textarea|autocorrect|uitextfield|android\.widget\.edit)/i;

export function isEditableElementType(type: string | undefined): boolean {
	if (!type) return false;
	return EDITABLE_TYPE_RE.test(type);
}

function selectionComment(selection: InspectorSelection): string | null {
	const id = selection.element?.id?.trim();
	if (id) return `# id ${id}`;
	const label = selection.element?.label?.trim();
	if (label) return `# ${label}`;
	if (selection.element?.type) return `# ${selection.element.type}`;
	return null;
}

function targetFields(
	selection: InspectorSelection,
): Pick<ActionRequest, "id" | "label" | "x" | "y"> {
	const id = selection.element?.id?.trim();
	if (id) return { id };
	const label = selection.element?.label?.trim();
	if (label) return { label };
	return { x: selection.x, y: selection.y };
}

function withComment(selection: InspectorSelection, line: string): string[] {
	const comment = selectionComment(selection);
	return comment ? [comment, line] : [line];
}

export function tapActionForSelection(
	selection: InspectorSelection,
	extras: Partial<Pick<ActionRequest, "double" | "durationMs">> = {},
): ActionRequest {
	return {
		kind: "tap",
		...targetFields(selection),
		...extras,
	};
}

/** Always tap by normalized x/y (even when id/label exist). */
export function tapPointActionForSelection(
	selection: InspectorSelection,
	extras: Partial<Pick<ActionRequest, "double" | "durationMs">> = {},
): ActionRequest {
	return {
		kind: "tap",
		x: selection.x,
		y: selection.y,
		...extras,
	};
}

export function tapLinesForSelection(
	selection: InspectorSelection,
	extras: Partial<Pick<ActionRequest, "double" | "durationMs">> = {},
): string[] {
	return withComment(selection, formatActionShellLine(tapActionForSelection(selection, extras)));
}

export function tapPointLinesForSelection(
	selection: InspectorSelection,
	extras: Partial<Pick<ActionRequest, "double" | "durationMs">> = {},
): string[] {
	const comment = selectionComment(selection);
	const line = formatActionShellLine(tapPointActionForSelection(selection, extras));
	return comment ? [comment, line] : [line];
}

export function assertLinesForSelection(
	selection: InspectorSelection,
	assertion: "visible" | "not-visible",
	textOverride?: string,
): string[] | null {
	const text = (textOverride ?? selection.element?.label ?? "").trim();
	if (!text) return null;
	return [
		formatAssertShellLine({
			assertion,
			text,
			timeoutSeconds: DEFAULT_ASSERT_TIMEOUT,
		}),
	];
}

export function inputLinesForSelection(selection: InspectorSelection, text: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const action: ActionRequest = {
		kind: "input",
		text: trimmed,
		...targetFields(selection),
	};
	return withComment(selection, formatActionShellLine(action));
}

export function waitLines(seconds: number): string[] {
	return [formatSleepShellLine(seconds)];
}

function appActionLines(
	kind: "activate-app" | "terminate-app" | "restart-app",
	appId: string,
): string[] {
	const trimmed = appId.trim();
	if (!trimmed) return [];
	const label =
		kind === "activate-app"
			? "activate app"
			: kind === "terminate-app"
				? "terminate app"
				: "restart app";
	return [`# ${label}`, formatActionShellLine({ kind, appId: trimmed })];
}

function openUrlLines(url: string): string[] {
	const trimmed = url.trim();
	if (!trimmed) return [];
	return ["# open url", formatActionShellLine({ kind: "open-url", url: trimmed })];
}

function alertLines(alertAction: "accept" | "dismiss"): string[] {
	return [`# ${alertAction} alert`, formatActionShellLine({ kind: "alert", alertAction })];
}

function previewTap(
	selection: InspectorSelection,
	extras?: Partial<Pick<ActionRequest, "double" | "durationMs">>,
): string[] {
	return [formatActionShellLine(tapActionForSelection(selection, extras))];
}

function previewTapPoint(
	selection: InspectorSelection,
	extras?: Partial<Pick<ActionRequest, "double" | "durationMs">>,
): string[] {
	return [formatActionShellLine(tapPointActionForSelection(selection, extras))];
}

function hasStableSelector(selection: InspectorSelection): boolean {
	return Boolean(selection.element?.id?.trim() || selection.element?.label?.trim());
}

function previewAssert(
	selection: InspectorSelection,
	assertion: "visible" | "not-visible",
): string[] {
	const text = selection.element?.label?.trim() || "…";
	return [
		formatAssertShellLine({
			assertion,
			text,
			timeoutSeconds: DEFAULT_ASSERT_TIMEOUT,
		}),
	];
}

function previewInput(selection: InspectorSelection): string[] {
	return [
		formatActionShellLine({
			kind: "input",
			text: INPUT_PLACEHOLDER,
			...targetFields(selection),
		}),
	];
}

function previewAppAction(
	kind: "activate-app" | "terminate-app" | "restart-app",
	appId: string,
): string[] {
	return [
		formatActionShellLine({
			kind,
			appId: appId.trim() || APP_ID_PLACEHOLDER,
		}),
	];
}

/** Suggested chips shown at the top of the element menu. */
export function suggestedCommands(selection: InspectorSelection): CommandSnippet[] {
	const editable = isEditableElementType(selection.element?.type);
	const hasLabel = Boolean(selection.element?.label?.trim());
	const stable = hasStableSelector(selection);

	const tap: CommandSnippet = {
		id: "tap",
		label: "tap",
		previewLines: previewTap(selection),
		needsPrompt: null,
	};
	const tapPoint: CommandSnippet = {
		id: "tapPoint",
		label: "tap (x,y)",
		previewLines: previewTapPoint(selection),
		needsPrompt: null,
	};
	const assertVisible: CommandSnippet = {
		id: "assertVisible",
		label: "assertVisible",
		previewLines: previewAssert(selection, "visible"),
		needsPrompt: hasLabel ? null : "text",
		promptKind: "text",
	};
	const inputText: CommandSnippet = {
		id: "inputText",
		label: "inputText",
		previewLines: previewInput(selection),
		needsPrompt: "text",
		promptKind: "text",
	};

	// Prefer id/label tap first when available, but always surface the x,y tap too.
	const taps = stable ? [tap, tapPoint] : [tapPoint];

	if (editable) {
		return [inputText, ...taps, assertVisible];
	}
	return [...taps, assertVisible, inputText];
}

/** Full selector-commands list for the submenu. */
export function selectorCommands(
	selection: InspectorSelection,
	context: SnippetContext,
): CommandSnippet[] {
	const hasLabel = Boolean(selection.element?.label?.trim());
	const stable = hasStableSelector(selection);
	const appId = context.defaultAppId.trim();

	const appControl: CommandSnippet[] = [
		{
			id: "activateApp",
			label: "activateApp",
			previewLines: previewAppAction("activate-app", appId),
			needsPrompt: "text",
			promptKind: "appId",
		},
		{
			id: "terminateApp",
			label: "terminateApp",
			previewLines: previewAppAction("terminate-app", appId),
			needsPrompt: "text",
			promptKind: "appId",
		},
		{
			id: "restartApp",
			label: "restartApp",
			previewLines: previewAppAction("restart-app", appId),
			needsPrompt: "text",
			promptKind: "appId",
		},
		{
			id: "openUrl",
			label: "openUrl",
			previewLines: [formatActionShellLine({ kind: "open-url", url: URL_PLACEHOLDER })],
			needsPrompt: "text",
			promptKind: "url",
		},
		{
			id: "acceptAlert",
			label: "acceptAlert",
			previewLines: [formatActionShellLine({ kind: "alert", alertAction: "accept" })],
			needsPrompt: null,
		},
		{
			id: "dismissAlert",
			label: "dismissAlert",
			previewLines: [formatActionShellLine({ kind: "alert", alertAction: "dismiss" })],
			needsPrompt: null,
		},
	];

	return [
		{
			id: "assertVisible",
			label: "assertVisible",
			previewLines: previewAssert(selection, "visible"),
			needsPrompt: hasLabel ? null : "text",
			promptKind: "text",
		},
		{
			id: "assertNotVisible",
			label: "assertNotVisible",
			previewLines: previewAssert(selection, "not-visible"),
			needsPrompt: hasLabel ? null : "text",
			promptKind: "text",
		},
		...(stable
			? [
					{
						id: "tap" as const,
						label: "tap",
						previewLines: previewTap(selection),
						needsPrompt: null,
					},
				]
			: []),
		{
			id: "tapPoint",
			label: "tap (x,y)",
			previewLines: previewTapPoint(selection),
			needsPrompt: null,
		},
		{
			id: "doubleTap",
			label: "doubleTap",
			previewLines: previewTap(selection, { double: true }),
			needsPrompt: null,
		},
		{
			id: "longPress",
			label: "longPress",
			previewLines: previewTap(selection, { durationMs: LONG_PRESS_MS }),
			needsPrompt: null,
		},
		{
			id: "inputText",
			label: "inputText",
			previewLines: previewInput(selection),
			needsPrompt: "text",
			promptKind: "text",
		},
		{
			id: "wait",
			label: "wait",
			previewLines: [formatSleepShellLine(DEFAULT_WAIT_SECONDS)],
			needsPrompt: "seconds",
			promptKind: "seconds",
		},
		...appControl,
	];
}

/** Build final script lines for a command after any prompt value is collected. */
export function buildCommandLines(
	selection: InspectorSelection,
	commandId: SnippetCommandId,
	promptValue?: string,
	context?: SnippetContext,
): string[] {
	switch (commandId) {
		case "tap":
			return tapLinesForSelection(selection);
		case "tapPoint":
			return tapPointLinesForSelection(selection);
		case "doubleTap":
			return tapLinesForSelection(selection, { double: true });
		case "longPress":
			return tapLinesForSelection(selection, { durationMs: LONG_PRESS_MS });
		case "assertVisible": {
			const lines = assertLinesForSelection(selection, "visible", promptValue);
			return lines ?? [];
		}
		case "assertNotVisible": {
			const lines = assertLinesForSelection(selection, "not-visible", promptValue);
			return lines ?? [];
		}
		case "inputText":
			return inputLinesForSelection(selection, promptValue ?? "");
		case "wait": {
			const seconds = Number(promptValue ?? DEFAULT_WAIT_SECONDS);
			if (!Number.isFinite(seconds) || seconds < 0) return waitLines(DEFAULT_WAIT_SECONDS);
			return waitLines(seconds);
		}
		case "activateApp":
			return appActionLines("activate-app", promptValue ?? context?.defaultAppId ?? "");
		case "terminateApp":
			return appActionLines("terminate-app", promptValue ?? context?.defaultAppId ?? "");
		case "restartApp":
			return appActionLines("restart-app", promptValue ?? context?.defaultAppId ?? "");
		case "openUrl":
			return openUrlLines(promptValue ?? "");
		case "acceptAlert":
			return alertLines("accept");
		case "dismissAlert":
			return alertLines("dismiss");
	}
}
