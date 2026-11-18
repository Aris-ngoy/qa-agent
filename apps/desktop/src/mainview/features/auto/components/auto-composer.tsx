import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import {
	useAutoModels,
	useSendAutoMessage,
	useSetAutoChatModel,
	useStopAutoRun,
} from "@/features/auto/hooks/usequery/use-auto";
import { modelFromKey, modelKey, modelOptions } from "@/features/auto/utils/chat-labels";
import { MODE_OPTIONS, canSend, isSendKey } from "@/features/auto/utils/composer";
import { isRunLive } from "@/features/auto/utils/run-card";
import { Button, ListBox, Select } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type { AutoChatMode } from "@yoqa/runner-client";
import { useEffect, useMemo } from "react";

/** Open things that Esc closes, rather than stopping the Run. */
const ESC_OWNERS = '[role="dialog"], [role="listbox"], [role="menu"]';

/**
 * The composer: the prompt, the mode it is sent in, the chat model, and Send. Enter sends,
 * Shift+Enter starts a new line; Send waits while a reply is being written. While the chat's
 * Run is live, Stop (or Esc) cancels it.
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
	const send = useSendAutoMessage();
	const stop = useStopAutoRun();
	const sendable = loaded && canSend({ text, sending: send.isPending, replying });

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
					placeholder={replying ? "The agent is replying…" : "Ask about a Test Case or its Runs"}
					rows={2}
					value={text}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<ModeControl mode={mode} onChange={(next) => composer$.mode.set(next)} />
					<ModelPicker chatId={chatId} />
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
							{replying ? "Replying…" : "Send"}
						</Button>
					</div>
				</div>
			</div>
			<p className="m-0 mt-1.5 px-1 text-helper text-outline">
				{MODE_OPTIONS.find((option) => option.id === mode)?.hint} Explore is coming soon.
			</p>
		</div>
	);
}

/** Ask / Run / Explore. Explore is off for now; it shows what it will do. */
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

/** The chat model, from the Claude Provider's models; Default leaves it to the Provider. */
function ModelPicker({ chatId }: { chatId: string }) {
	const modelsQuery = useAutoModels();
	const chatModel = useValue(shownAutoChat$.chat.model) ?? null;
	const setModel = useSetAutoChatModel();
	const options = useMemo(
		() =>
			modelOptions(
				modelsQuery.data?.models ?? [],
				modelsQuery.data?.defaultModel ?? null,
				chatModel,
			),
		[modelsQuery.data, chatModel],
	);

	return (
		<Select
			aria-label="Chat model"
			className="w-44"
			isDisabled={setModel.isPending || modelsQuery.isLoading}
			onSelectionChange={(key) => {
				if (key == null) return;
				const next = modelFromKey(String(key));
				if (next === chatModel) return;
				setModel.mutate({ chatId, model: next });
			}}
			selectedKey={modelKey(chatModel)}
		>
			<Select.Trigger className="h-8 rounded-lg border-0 bg-surface-container px-2.5 text-helper font-medium shadow-none">
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{options.map((option) => (
						<ListBox.Item id={option.id} key={option.id} textValue={option.label}>
							{option.label}
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
