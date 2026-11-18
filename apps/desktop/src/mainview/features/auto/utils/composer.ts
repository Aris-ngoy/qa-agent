import type { AutoChatMode } from "@yoqa/runner-client";

export type ModeOption = { id: AutoChatMode; label: string; enabled: boolean; hint: string };

/** The composer's modes. Ask and Run work for now; Explore comes with a later ticket. */
export const MODE_OPTIONS: ModeOption[] = [
	{ id: "ask", label: "Ask", enabled: true, hint: "Reads the Test Case and its Runs only." },
	{
		id: "run",
		label: "Run",
		enabled: true,
		hint: "Also writes the Case draft. Running it comes soon.",
	},
	{
		id: "explore",
		label: "Explore",
		enabled: false,
		hint: "Coming soon: drive the device and propose a Test Case.",
	},
];

/** Enter sends; Shift+Enter is a new line, and Enter that confirms an IME composition is neither. */
export function isSendKey(event: {
	key: string;
	shiftKey: boolean;
	isComposing: boolean;
}): boolean {
	return event.key === "Enter" && !event.shiftKey && !event.isComposing;
}

/** Send is off with nothing to say, while the last message is sending, and while a reply is written. */
export function canSend(input: { text: string; sending: boolean; replying: boolean }): boolean {
	return input.text.trim().length > 0 && !input.sending && !input.replying;
}
