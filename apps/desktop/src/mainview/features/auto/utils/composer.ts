import type { AutoChatMode } from "@yoqa/runner-client";

export type ModeOption = { id: AutoChatMode; label: string; enabled: boolean; hint: string };

/** The composer's modes, from the narrowest (Ask) to the widest (Explore). */
export const MODE_OPTIONS: ModeOption[] = [
	{ id: "ask", label: "Ask", enabled: true, hint: "Reads the Test Case and its Runs only." },
	{
		id: "run",
		label: "Run",
		enabled: true,
		hint: "Also writes the Case draft and runs it on the connected device.",
	},
	{
		id: "explore",
		label: "Explore",
		enabled: true,
		hint: "Also reads the Screen, acts on the device and proposes a new Test Case.",
	},
];

/** The composer's option for `mode`. */
export function modeOption(mode: AutoChatMode): ModeOption | undefined {
	return MODE_OPTIONS.find((option) => option.id === mode);
}

/** Enter sends; Shift+Enter is a new line, and Enter that confirms an IME composition is neither. */
export function isSendKey(event: {
	key: string;
	shiftKey: boolean;
	isComposing: boolean;
}): boolean {
	return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

/**
 * Send is off with nothing to say, while the last message is sending, and while a reply is
 * written, unless the message is `queueing` (the chat's Run is live, or messages already wait).
 */
export function canSend(input: {
	text: string;
	sending: boolean;
	replying: boolean;
	queueing: boolean;
}): boolean {
	return input.text.trim().length > 0 && !input.sending && (!input.replying || input.queueing);
}

/**
 * The line under the composer: what the mode does, or that Enter queues while the Run is live
 * (and Esc stops it), or while messages still wait for the agent's reply about it.
 */
export function composerHint(input: {
	mode: AutoChatMode;
	runLive: boolean;
	queueing: boolean;
}): string {
	if (input.runLive) return "Enter queues your message until the run finishes · Esc to stop";
	if (input.queueing) return "Enter queues your message behind the ones waiting";
	return modeOption(input.mode)?.hint ?? "";
}
