import { toolCallInputText, toolCallName, toolCallState } from "@/features/auto/utils/chat-labels";
import type { AutoMessage, AutoReply, AutoToolCall } from "@yoqa/runner-client";

/** One saved message: the user's prompt on the right, the agent's reply on the left. */
export function AutoMessageBubble({ message }: { message: AutoMessage }) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<p className="m-0 max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-surface-container-high px-4 py-2.5 text-body-md text-on-surface">
					{message.text}
				</p>
			</div>
		);
	}
	return (
		<ReplyBody
			text={message.text}
			toolCalls={message.toolCalls}
			error={message.error}
			writing={false}
		/>
	);
}

/** The reply being written right now. */
export function AutoReplyBubble({ reply }: { reply: AutoReply }) {
	return <ReplyBody text={reply.text} toolCalls={reply.toolCalls} error={null} writing />;
}

function ReplyBody({
	text,
	toolCalls,
	error,
	writing,
}: {
	text: string;
	toolCalls: AutoToolCall[];
	error: string | null;
	writing: boolean;
}) {
	return (
		<div className="flex max-w-[92%] flex-col gap-2" aria-busy={writing || undefined}>
			{toolCalls.length > 0 ? (
				<ul className="m-0 flex list-none flex-col gap-1 p-0">
					{toolCalls.map((call) => (
						<li key={call.id}>
							<ToolCallRow call={call} />
						</li>
					))}
				</ul>
			) : null}
			{text ? (
				<p className="m-0 whitespace-pre-wrap break-words text-body-md leading-relaxed text-on-surface">
					{text}
					{writing ? <WritingCaret /> : null}
				</p>
			) : writing ? (
				<p className="m-0 inline-flex items-center gap-2 text-body-sm text-on-surface-variant">
					<span className="relative flex size-1.5">
						<span className="absolute inline-flex size-full animate-ping rounded-full bg-secondary opacity-60" />
						<span className="relative inline-flex size-1.5 rounded-full bg-secondary" />
					</span>
					Thinking…
				</p>
			) : null}
			{error ? (
				<p className="m-0 rounded-lg bg-error-container px-3 py-2 text-body-sm text-on-error-container">
					{error}
				</p>
			) : null}
		</div>
	);
}

function WritingCaret() {
	return (
		<span
			aria-hidden="true"
			className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-on-surface-variant align-[-0.15em]"
		/>
	);
}

const STATE_DOT: Record<ReturnType<typeof toolCallState>, string> = {
	running: "bg-secondary animate-pulse",
	failed: "bg-error",
	done: "bg-outline",
};

/** A Yoqa tool call as a compact row; open it to read what the tool answered. */
function ToolCallRow({ call }: { call: AutoToolCall }) {
	const state = toolCallState(call);
	const input = toolCallInputText(call.input);
	return (
		<details className="group rounded-lg border border-outline-variant bg-surface-container-low">
			<summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-helper text-on-surface-variant [&::-webkit-details-marker]:hidden">
				<span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${STATE_DOT[state]}`} />
				<span className="shrink-0 font-medium text-on-surface">{toolCallName(call.name)}</span>
				{input ? <code className="min-w-0 truncate font-mono text-[11px]">{input}</code> : null}
				<span className="ml-auto shrink-0 text-outline">
					{state === "running" ? "Running…" : state === "failed" ? "Failed" : ""}
				</span>
				<svg
					aria-hidden="true"
					className="size-3.5 shrink-0 text-outline transition-transform group-open:rotate-90"
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="2"
					viewBox="0 0 24 24"
				>
					<path d="M9 6l6 6-6 6" />
				</svg>
			</summary>
			<pre
				className={[
					"m-0 max-h-64 overflow-auto border-t border-outline-variant px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words",
					state === "failed" ? "text-error" : "text-on-surface-variant",
				].join(" ")}
			>
				{call.output ?? "Waiting for the tool…"}
			</pre>
		</details>
	);
}
