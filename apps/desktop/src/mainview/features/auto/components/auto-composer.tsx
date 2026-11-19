import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import {
	useAutoModels,
	useSendAutoMessage,
	useSetAutoChatAgent,
	useStopAutoRun,
} from "@/features/auto/hooks/usequery/use-auto";
import {
	chatAgentLabel,
	chatProviderProblem,
	pickFromKey,
	pickerKey,
	pickerSections,
} from "@/features/auto/utils/chat-labels";
import { MODE_OPTIONS, canSend, composerHint, isSendKey } from "@/features/auto/utils/composer";
import { isRunLive } from "@/features/auto/utils/run-card";
import { ProviderLogo } from "@/features/providers/components/driver-glyph";
import { Button, Header, ListBox, Select } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type { AutoChatMode } from "@yoqa/runner-client";
import { useEffect, useMemo } from "react";

/** Open things that Esc closes, rather than stopping the Run. */
const ESC_OWNERS = '[role="dialog"], [role="listbox"], [role="menu"]';

/**
 * The composer: the prompt, the mode it is sent in, the chat's Provider and model, and Send. Enter sends,
 * Shift+Enter starts a new line; Send waits while a reply is being written. While the chat's
 * Run is live, Enter queues the message until the Run ends, and Stop (or Esc) cancels the Run.
 */
export function AutoComposer({ chatId }: { chatId: string }) {
	const composer$ = useObservable({ text: "", mode: "ask" as AutoChatMode });
	const text = useValue(composer$.text);
	const mode = useValue(composer$.mode);
	const loaded = useValue(() => shownAutoChat$.chat.id.get() === chatId);
	const replying = useValue(() => shownAutoChat$.chat.reply.get() != null);
	const runLive = useValue(() => {
		const run = shownAutoChat$.chat.run.get();
		return run != null && isRunLive(run);
	});
	// The runner queues a message while the Run is live, and behind messages already queued.
	const queued = useValue(() => shownAutoChat$.chat.queue.get()?.length ?? 0);
	const queueing = runLive || queued > 0;
	const send = useSendAutoMessage();
	const stop = useStopAutoRun();
	const sendable = loaded && canSend({ text, sending: send.isPending, replying, queueing });
	const providerProblem = useProviderProblem();

	const stopRun = stop.mutate;

	// Esc stops the Run from anywhere on the screen, except to close something open (a menu, a dialog).
	useEffect(() => {
		if (!runLive) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest(ESC_OWNERS)) return;
			event.preventDefault();
			stopRun(chatId);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [runLive, chatId, stopRun]);

	const submit = () => {
		if (!sendable) return;
		send.mutate({ chatId, text: text.trim(), mode }, { onSuccess: () => composer$.text.set("") });
	};

	return (
		<div className="shrink-0 border-t border-outline-variant bg-surface-container-lowest p-3">
			{loaded && providerProblem ? (
				<p
					className="m-0 mb-2 rounded-lg bg-error-container px-3 py-2 text-helper text-on-error-container"
					role="alert"
				>
					{providerProblem}
				</p>
			) : null}
			<div className="flex flex-col gap-2 rounded-xl border border-outline-variant bg-surface-bright px-3 py-2 focus-within:border-primary/35 focus-within:ring-2 focus-within:ring-primary/10">
				<textarea
					aria-label="Message"
					className="max-h-48 min-h-[2.75rem] w-full resize-none border-0 bg-transparent text-body-md text-on-surface outline-none placeholder:text-on-surface-variant/65"
					onChange={(event) => composer$.text.set(event.target.value)}
					onKeyDown={(event) => {
						const { key, shiftKey } = event;
						if (!isSendKey({ key, shiftKey, isComposing: event.nativeEvent.isComposing })) return;
						event.preventDefault();
						submit();
					}}
					placeholder={
						queueing
							? "Queue a message for when the run ends"
							: replying
								? "The agent is replying…"
								: "Ask about a Test Case or its Runs"
					}
					rows={2}
					value={text}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<ModeControl mode={mode} onChange={(next) => composer$.mode.set(next)} />
					<AgentPicker chatId={chatId} />
					<div className="ml-auto flex items-center gap-2">
						{runLive ? (
							<Button
								className="h-8 rounded-lg bg-error-container px-4 text-body-sm font-semibold text-on-error-container data-[hovered=true]:bg-error-container/80"
								isDisabled={stop.isPending}
								onPress={() => stop.mutate(chatId)}
							>
								Stop <span className="ml-1 font-mono text-[10px] opacity-70">Esc</span>
							</Button>
						) : null}
						<Button
							className="h-8 rounded-lg bg-primary px-4 text-body-sm font-semibold text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
							isDisabled={!sendable}
							onPress={submit}
						>
							{queueing ? "Queue" : replying ? "Replying…" : "Send"}
						</Button>
					</div>
				</div>
			</div>
			<p className="m-0 mt-1.5 px-1 text-helper text-outline">
				{composerHint({ mode, runLive, queueing })}
			</p>
		</div>
	);
}

/** Why the shown chat's Provider cannot answer, once the Providers are read; null while it can. */
function useProviderProblem(): string | null {
	const modelsQuery = useAutoModels();
	const providerId = useValue(shownAutoChat$.chat.providerId) ?? null;
	if (!modelsQuery.data) return null;
	return chatProviderProblem(modelsQuery.data.providers, { providerId });
}

/** Ask / Run / Explore, each naming what it may do. */
function ModeControl({
	mode,
	onChange,
}: {
	mode: AutoChatMode;
	onChange: (mode: AutoChatMode) => void;
}) {
	return (
		<fieldset
			aria-label="Mode"
			className="m-0 flex h-8 items-center gap-0.5 rounded-lg border-0 bg-surface-container p-0.5"
		>
			{MODE_OPTIONS.map((option) => {
				const selected = option.id === mode;
				return (
					<button
						aria-pressed={selected}
						className={[
							"h-7 rounded-md px-3 text-helper font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
							selected
								? "bg-surface-bright text-on-surface shadow-card"
								: "text-on-surface-variant hover:text-on-surface",
						].join(" ")}
						disabled={!option.enabled}
						key={option.id}
						onClick={() => onChange(option.id)}
						title={option.hint}
						type="button"
					>
						{option.label}
					</button>
				);
			})}
		</fieldset>
	);
}

/**
 * Who answers the chat: a Provider and its model, every Provider grouped under its label and
 * logo. A Provider that cannot chat now is shown off, with why; Default leaves the model to
 * the Provider. Another Provider carries the chat on from what it shows.
 */
function AgentPicker({ chatId }: { chatId: string }) {
	const modelsQuery = useAutoModels();
	const chatProviderId = useValue(shownAutoChat$.chat.providerId) ?? null;
	const chatModel = useValue(shownAutoChat$.chat.model) ?? null;
	const setAgent = useSetAutoChatAgent();
	const providers = modelsQuery.data?.providers ?? [];
	const chat = { providerId: chatProviderId, model: chatModel };
	const sections = useMemo(
		() =>
			pickerSections(modelsQuery.data?.providers ?? [], {
				providerId: chatProviderId,
				model: chatModel,
			}),
		[modelsQuery.data, chatProviderId, chatModel],
	);
	const selectedKey = sections.some((section) => section.providerId === chatProviderId)
		? pickerKey(chatProviderId ?? "", chatModel)
		: null;

	return (
		<Select
			aria-label="Provider and model"
			className="w-60"
			isDisabled={setAgent.isPending || modelsQuery.isLoading}
			onSelectionChange={(key) => {
				if (key == null) return;
				const pick = pickFromKey(String(key));
				if (!pick || (pick.providerId === chatProviderId && pick.model === chatModel)) return;
				setAgent.mutate({ chatId, ...pick });
			}}
			placeholder="Pick a Provider"
			selectedKey={selectedKey}
		>
			<Select.Trigger className="h-8 rounded-lg border-0 bg-surface-container px-2.5 text-helper font-medium shadow-none">
				<span className="truncate">{chatAgentLabel(providers, chat)}</span>
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{sections.map((section) => (
						<ListBox.Section key={section.providerId}>
							<Header className="flex items-center gap-2 px-2 pt-2 pb-1 text-helper font-semibold text-on-surface-variant">
								<ProviderLogo kind={section.kind} />
								{section.label}
							</Header>
							{section.available ? (
								section.options.map((option) => (
									<ListBox.Item
										id={option.key}
										key={option.key}
										textValue={`${section.label} ${option.label}`}
									>
										{option.label}
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))
							) : (
								<ListBox.Item
									id={`unavailable:${section.providerId}`}
									isDisabled
									textValue={`${section.label} unavailable`}
								>
									<span className="whitespace-normal text-helper text-outline">
										{section.reason}
									</span>
								</ListBox.Item>
							)}
						</ListBox.Section>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
