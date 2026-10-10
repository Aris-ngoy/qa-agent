import {
	type CommandSnippet,
	type SelectorKind,
	type SnippetCommandId,
	type SnippetContext,
	type StepCommand,
	buildCommandLines,
	buildStepLines,
	defaultSelectorKind,
	isEditableElementType,
	selectorCommands,
	selectorOptions,
	usableLabel,
} from "@/features/inspector/command-snippets";
import { ScreenGestures } from "@/features/inspector/screen-gestures";
import type { InspectorSelection } from "@/features/inspector/selection";
import { Input, Label, Modal, TextField } from "@heroui/react";
import type { ScreenElement } from "@yoqa/runner-client";
import { type ReactNode, useMemo, useState } from "react";

type Direction = "up" | "down" | "left" | "right";

type ElementActionDialogProps = {
	selection: InspectorSelection | null;
	elements: ScreenElement[];
	/** True when steps cannot be added or run (no session, or a run owns the device). */
	disabled: boolean;
	snippetContext: SnippetContext;
	canChangeSelector: boolean;
	onChangeSelector: () => void;
	onInsert: (lines: string[]) => void;
	onInsertAndRun: (lines: string[]) => void;
	onCopyLines: (lines: string[]) => void;
	onClose: () => void;
	gesturesDisabled: boolean;
	onAddSwipe: (direction: Direction) => void;
	onAddWait: (seconds: number) => void;
};

type CommandChoice =
	| { kind: "step"; command: StepCommand }
	| { kind: "more"; id: SnippetCommandId };

const STEP_COMMANDS: { command: StepCommand; title: string }[] = [
	{ command: "tap", title: "Tap" },
	{ command: "assertVisible", title: "Assert visible" },
	{ command: "longPress", title: "Long press" },
	{ command: "doubleTap", title: "Double tap" },
	{ command: "inputText", title: "Type text" },
];

/** Commands from the old "Selector commands" list that do not depend on how the element is found. */
const MORE_COMMAND_IDS: ReadonlySet<SnippetCommandId> = new Set([
	"assertNotVisible",
	"wait",
	"activateApp",
	"terminateApp",
	"restartApp",
	"openUrl",
	"acceptAlert",
	"dismissAlert",
	"screenshot",
	"screenshotPath",
]);

const SELECTOR_NOTE: Record<SelectorKind, string> = {
	label: "Recommended: accessibility labels rarely change between builds.",
	id: "Recommended: accessibility IDs are stable across builds and languages.",
	both: "Matches only when the ID and the label both agree.",
	point: "Raw coordinates break whenever the layout moves — use only as a last resort.",
};

function Icon({ children, className = "size-4" }: { children: ReactNode; className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			{children}
		</svg>
	);
}

function defaultPromptValue(snippet: CommandSnippet | undefined, context: SnippetContext): string {
	if (snippet?.needsPrompt === "seconds") return "1";
	if (snippet?.promptKind === "appId") return context.defaultAppId;
	if (snippet?.promptKind === "path") return "/tmp/yoqa-screenshot.png";
	return "";
}

function titleOf(selection: InspectorSelection): string {
	return selection.element?.label?.trim() || selection.element?.type || "Point";
}

function typeBadge(selection: InspectorSelection): string | null {
	const type = selection.element?.type;
	if (!type) return null;
	return type.replace(/^XCUIElementType/, "").replace(/^android\.widget\./, "") || null;
}

function MatchBadge({ matches }: { matches: number | null }) {
	if (matches == null) {
		return (
			<span className="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-semibold text-on-surface">
				Fragile
			</span>
		);
	}
	const unique = matches <= 1;
	return (
		<span
			className={[
				"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
				unique
					? "bg-secondary-container text-on-secondary-container"
					: "bg-warning/20 text-on-surface",
			].join(" ")}
		>
			{matches} {matches === 1 ? "match" : "matches"}
		</span>
	);
}

export function ElementActionDialog(props: ElementActionDialogProps) {
	const { selection, onClose } = props;
	return (
		<Modal>
			<Modal.Backdrop
				isOpen={selection != null}
				onOpenChange={(open) => {
					if (!open) onClose();
				}}
				variant="blur"
			>
				<Modal.Container placement="center" size="lg">
					<Modal.Dialog className="rounded-xl sm:max-w-sm">
						{selection ? (
							<DialogBody
								key={`${selection.x},${selection.y},${selection.candidateIndex},${selection.preferredLocator},${selection.element?.id ?? ""},${selection.element?.label ?? ""}`}
								{...props}
								selection={selection}
							/>
						) : null}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

function DialogBody({
	selection,
	elements,
	disabled,
	snippetContext,
	canChangeSelector,
	onChangeSelector,
	onInsert,
	onInsertAndRun,
	onCopyLines,
	onClose,
	gesturesDisabled,
	onAddSwipe,
	onAddWait,
}: ElementActionDialogProps & { selection: InspectorSelection }) {
	const editable = isEditableElementType(selection.element?.type);
	const [choice, setChoice] = useState<CommandChoice>({
		kind: "step",
		command: editable ? "inputText" : "tap",
	});
	const [selector, setSelector] = useState<SelectorKind>(() => defaultSelectorKind(selection));
	const [text, setText] = useState("");
	const [assertText, setAssertText] = useState(usableLabel(selection.element) ?? "");
	const [moreOpen, setMoreOpen] = useState(false);
	const [moreValue, setMoreValue] = useState<string | null>(null);

	const options = useMemo(() => selectorOptions(selection, elements), [selection, elements]);
	const moreCommands = useMemo(
		() => selectorCommands(selection, snippetContext).filter((c) => MORE_COMMAND_IDS.has(c.id)),
		[selection, snippetContext],
	);
	const activeMore = choice.kind === "more" ? moreCommands.find((c) => c.id === choice.id) : null;

	const initialMoreValue = (id: SnippetCommandId): string =>
		defaultPromptValue(
			moreCommands.find((c) => c.id === id),
			snippetContext,
		);

	const lines = useMemo(() => {
		if (choice.kind === "more") {
			const snippet = moreCommands.find((c) => c.id === choice.id);
			const value = moreValue ?? defaultPromptValue(snippet, snippetContext);
			if (snippet?.needsPrompt === "text" && value.trim().length === 0) return [];
			if (snippet?.needsPrompt === "seconds") {
				const n = Number(value);
				if (!Number.isFinite(n) || n < 0) return [];
			}
			return buildCommandLines(selection, choice.id, value.trim(), snippetContext);
		}
		return buildStepLines(selection, {
			command: choice.command,
			selector,
			text: choice.command === "assertVisible" ? assertText.trim() || undefined : text,
		});
	}, [assertText, choice, moreCommands, moreValue, selection, selector, snippetContext, text]);

	const stepCommand = choice.kind === "step" ? choice.command : null;
	const needsSelector = stepCommand != null && stepCommand !== "assertVisible";
	const needsTextField = stepCommand === "inputText" || stepCommand === "assertVisible";
	const selectedOption = options.find((o) => o.kind === selector) ?? options[0];

	const finish = (action: (lines: string[]) => void) => {
		if (lines.length === 0 || disabled) return;
		action(lines);
		onClose();
	};

	const choose = (next: CommandChoice) => {
		setChoice(next);
		setMoreValue(null);
	};

	const badge = typeBadge(selection);

	return (
		<>
			<Modal.CloseTrigger />
			<Modal.Header className="flex flex-col gap-1 border-b border-outline-variant pb-4">
				<div className="flex items-center gap-3">
					<Modal.Heading className="truncate text-sm! font-semibold! text-on-surface">
						{titleOf(selection)}
					</Modal.Heading>
					{badge ? (
						<span className="shrink-0 rounded-md bg-violet-container px-2 py-0.5 text-[10px] font-semibold text-on-violet-container">
							{badge}
						</span>
					) : null}
				</div>
				<p className="m-0 text-[11px] text-on-surface-variant">
					Pick a command, then how to find this element.
					{canChangeSelector ? (
						<>
							{" "}
							<button
								type="button"
								className="font-semibold text-on-violet-container underline-offset-2 hover:underline"
								onClick={onChangeSelector}
							>
								Not this element?
							</button>
						</>
					) : null}
				</p>
			</Modal.Header>

			<Modal.Body className="flex flex-col gap-3 py-2">
				<section className="flex flex-col gap-2">
					<h3 className="m-0 text-[11px] font-semibold text-on-surface">1. Command</h3>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
						{STEP_COMMANDS.map(({ command, title }) => {
							const picked = choice.kind === "step" && choice.command === command;
							return (
								<button
									key={command}
									type="button"
									aria-pressed={picked}
									className={[
										"min-h-7 rounded-xl border text-[11px] font-semibold transition-colors",
										picked
											? "border-violet bg-violet text-on-violet"
											: "border-outline-variant bg-surface-bright text-on-surface hover:bg-surface-container",
									].join(" ")}
									onClick={() => choose({ kind: "step", command })}
								>
									{title}
								</button>
							);
						})}
					</div>
					<button
						type="button"
						aria-expanded={moreOpen}
						className="w-fit text-[10px] font-semibold text-on-violet-container underline-offset-2 hover:underline"
						onClick={() => setMoreOpen((open) => !open)}
					>
						{moreOpen ? "Fewer commands" : "More commands (app, alerts, wait, screenshot)…"}
					</button>
					{moreOpen ? (
						<div className="flex flex-wrap gap-1.5">
							{moreCommands.map((snippet) => {
								const picked = choice.kind === "more" && choice.id === snippet.id;
								return (
									<button
										key={snippet.id}
										type="button"
										aria-pressed={picked}
										className={[
											"rounded-lg border px-2.5 py-1 font-mono text-[10px] transition-colors",
											picked
												? "border-violet bg-violet-container text-on-violet-container"
												: "border-outline-variant bg-surface-bright text-on-surface hover:bg-surface-container",
										].join(" ")}
										onClick={() => choose({ kind: "more", id: snippet.id })}
									>
										{snippet.label}
									</button>
								);
							})}
						</div>
					) : null}
				</section>

				{needsTextField ? (
					<TextField
						className="w-full"
						value={stepCommand === "assertVisible" ? assertText : text}
						onChange={stepCommand === "assertVisible" ? setAssertText : setText}
					>
						<Label className="mb-1 text-[10px] font-semibold text-on-surface">
							{stepCommand === "assertVisible" ? "Text that should be visible" : "Text to type"}
						</Label>
						<Input
							autoFocus={stepCommand === "inputText"}
							placeholder={stepCommand === "assertVisible" ? "Label on screen" : "Enter text…"}
						/>
					</TextField>
				) : null}

				{activeMore?.needsPrompt ? (
					<TextField
						className="w-full"
						value={moreValue ?? initialMoreValue(activeMore.id)}
						onChange={setMoreValue}
					>
						<Label className="mb-1 text-[10px] font-semibold text-on-surface">
							{activeMore.needsPrompt === "seconds"
								? "Seconds to wait"
								: activeMore.promptKind === "appId"
									? "App ID"
									: activeMore.promptKind === "url"
										? "URL"
										: "Output path"}
						</Label>
						<Input autoFocus />
					</TextField>
				) : null}

				{needsSelector ? (
					<section className="flex flex-col gap-2">
						<h3 className="m-0 text-[11px] font-semibold text-on-surface">2. Selector</h3>
						<fieldset
							aria-label="Selector"
							className="m-0 flex min-w-0 flex-col overflow-hidden rounded-xl border border-outline-variant p-0"
						>
							{options.map((option, index) => {
								const checked = option.kind === selector;
								return (
									<label
										key={option.kind}
										className={[
											"flex cursor-pointer items-center gap-3 px-2.5 py-1.5 transition-colors",
											index > 0 ? "border-t border-outline-variant" : "",
											checked ? "bg-violet-container/60" : "hover:bg-surface-container-low",
										].join(" ")}
									>
										<input
											type="radio"
											name="inspector-selector"
											className="sr-only"
											checked={checked}
											onChange={() => setSelector(option.kind)}
										/>
										<span
											aria-hidden="true"
											className={[
												"flex size-3.5 shrink-0 items-center justify-center rounded-full border-2",
												checked ? "border-violet" : "border-outline",
											].join(" ")}
										>
											{checked ? <span className="size-1.5 rounded-full bg-violet" /> : null}
										</span>
										<span className="w-16 shrink-0 text-[11px] font-semibold text-on-surface">
											{option.title}
										</span>
										<code className="min-w-0 flex-1 truncate font-mono text-[10px] text-on-surface">
											{option.flags}
										</code>
										<MatchBadge matches={option.matches} />
									</label>
								);
							})}
						</fieldset>
						{selectedOption ? (
							<p className="m-0 text-[10px] text-on-surface-variant">
								{SELECTOR_NOTE[selectedOption.kind]}
							</p>
						) : null}
					</section>
				) : null}

				<section className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<h3 className="m-0 text-[11px] font-semibold text-on-surface">Preview</h3>
						<button
							type="button"
							className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50"
							disabled={lines.length === 0}
							onClick={() => finish(onCopyLines)}
						>
							<Icon className="size-3">
								<rect x="9" y="9" width="12" height="12" rx="2" />
								<path d="M5 15V5a2 2 0 0 1 2-2h8" />
							</Icon>
							Copy
						</button>
					</div>
					<pre className="m-0 min-h-12 whitespace-pre-wrap break-all rounded-xl bg-[#17161d] px-2.5 py-1 font-mono text-[10px] leading-snug text-[#e6e3f0]">
						{lines.length > 0 ? lines.join("\n") : "Fill in the field above to see the command."}
					</pre>
				</section>

				<details className="group rounded-xl border border-outline-variant">
					<summary className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] font-semibold text-on-surface">
						Screen gestures
						<span className="ml-2 text-[10px] font-normal text-on-surface-variant">
							swipe and wait — no element needed
						</span>
					</summary>
					<div className="border-t border-outline-variant p-3">
						<ScreenGestures
							disabled={gesturesDisabled}
							onAddSwipe={onAddSwipe}
							onAddWait={onAddWait}
						/>
					</div>
				</details>
			</Modal.Body>

			<Modal.Footer className="flex items-center justify-between border-t border-outline-variant pt-4">
				<button
					type="button"
					disabled={disabled || lines.length === 0}
					className="inline-flex min-h-7 items-center gap-2 rounded-xl border border-outline-variant bg-surface-bright px-2.5 text-[11px] font-semibold text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50"
					onClick={() => finish(onInsertAndRun)}
				>
					<svg aria-hidden="true" className="size-3" fill="currentColor" viewBox="0 0 24 24">
						<path d="M6 3l15 9-15 9z" />
					</svg>
					Run on device
				</button>
				<div className="flex items-center gap-3">
					<button
						type="button"
						className="min-h-7 rounded-xl px-2.5 text-[11px] font-semibold text-on-surface transition-colors hover:bg-surface-container"
						onClick={onClose}
					>
						Cancel
					</button>
					<button
						type="button"
						disabled={disabled || lines.length === 0}
						className="inline-flex min-h-7 items-center gap-2 rounded-xl bg-violet px-3 text-[11px] font-semibold text-on-violet transition-opacity disabled:opacity-50"
						onClick={() => finish(onInsert)}
					>
						<Icon className="size-3">
							<path d="M12 5v14M5 12h14" />
						</Icon>
						Add to script
					</button>
				</div>
			</Modal.Footer>
		</>
	);
}
