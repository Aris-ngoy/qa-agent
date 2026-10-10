import {
	type CommandSnippet,
	type SnippetCommandId,
	type SnippetContext,
	buildCommandLines,
	selectorCommands,
	suggestedCommands,
} from "@/features/inspector/command-snippets";
import type { InspectorSelection } from "@/features/inspector/selection";
import { Button, Input, Label, TextField } from "@heroui/react";
import { type SVGProps, useMemo, useState } from "react";

type SelectedElementCardProps = {
	selection: InspectorSelection | null;
	disabled: boolean;
	snippetContext: SnippetContext;
	canChangeSelector: boolean;
	onChangeSelector: () => void;
	onInsert: (lines: string[]) => void;
	onInsertAndRun: (lines: string[]) => void;
	onCopyLines: (lines: string[]) => void;
	onClearSelection: () => void;
};

type PanelView = "main" | "selector" | "prompt";

type PromptState = {
	commandId: SnippetCommandId;
	kind: "text" | "seconds";
	label: string;
	promptKind?: CommandSnippet["promptKind"];
	returnView: "main" | "selector";
};

function ChevronIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true" {...props}>
			<path
				d="M6 3.5 10.5 8 6 12.5"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function PlayIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			viewBox="0 0 16 16"
			width="14"
			height="14"
			fill="currentColor"
			aria-hidden="true"
			{...props}
		>
			<path d="M4.5 2.8v10.4L13 8 4.5 2.8Z" />
		</svg>
	);
}

function InsertIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" {...props}>
			<path
				d="M3 4.5h7.5M3 8h10M3 11.5h7.5M12.5 3v4M10.5 5h4"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function CopyIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" {...props}>
			<rect x="5" y="5" width="7.5" height="7.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
			<path
				d="M3.5 10.5V3.8A1.3 1.3 0 0 1 4.8 2.5h6.7"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function ListIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" {...props}>
			<path
				d="M3 4h10M3 8h10M3 12h10"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function CodeIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" {...props}>
			<path
				d="m5 4-3 4 3 4M11 4l3 4-3 4"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ChangeSelectorIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true" {...props}>
			<path
				d="M3 5.5h7.5M10.5 3.5 12.5 5.5 10.5 7.5M13 10.5H5.5M5.5 8.5 3.5 10.5 5.5 12.5"
				stroke="currentColor"
				strokeWidth="1.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function promptHeading(prompt: PromptState): string {
	if (prompt.kind === "seconds") return `Wait seconds for ${prompt.label}`;
	if (prompt.promptKind === "appId") return `App ID for ${prompt.label}`;
	if (prompt.promptKind === "url") return `URL for ${prompt.label}`;
	if (prompt.promptKind === "path") return `Output path for ${prompt.label}`;
	return `Text for ${prompt.label}`;
}

function promptPlaceholder(prompt: PromptState): string {
	if (prompt.kind === "seconds") return "1";
	if (prompt.promptKind === "appId") return "com.example.app";
	if (prompt.promptKind === "url") return "myapp://path or https://…";
	if (prompt.promptKind === "path") return "/tmp/yoqa-screenshot.png";
	return "Enter text…";
}

const BTN =
	"inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-surface px-2.5 py-1.5 text-body-sm text-on-surface transition-colors hover:bg-surface-container disabled:opacity-50";

function Detail({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-helper text-on-surface-variant">{label}</dt>
			<dd className="truncate font-mono text-body-sm text-on-surface" title={value}>
				{value}
			</dd>
		</div>
	);
}

function selectionTitle(selection: InspectorSelection): string {
	const label = selection.element?.label?.trim();
	if (label) return label;
	return selection.element?.type ?? "Point";
}

export function SelectedElementCard(props: SelectedElementCardProps) {
	const { selection, onClearSelection } = props;
	return (
		<section
			aria-labelledby="inspector-element-heading"
			className="flex flex-col gap-3 rounded-xl border border-outline-variant/30 bg-surface-container/40 p-3"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<span className="text-helper text-on-surface-variant">Selected element</span>
					<h2
						id="inspector-element-heading"
						className="truncate text-title-sm font-semibold text-on-surface"
					>
						{selection ? selectionTitle(selection) : "Nothing selected"}
					</h2>
				</div>
				{selection ? (
					<button
						type="button"
						aria-label="Clear selection"
						title="Clear selection"
						className="rounded-md px-1.5 py-0.5 text-body-sm text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
						onClick={onClearSelection}
					>
						✕
					</button>
				) : null}
			</div>
			{selection ? (
				<SelectedElementActions
					key={`${selection.x},${selection.y},${selection.candidateIndex},${selection.preferredLocator},${selection.element?.id ?? ""},${selection.element?.label ?? ""}`}
					{...props}
					selection={selection}
				/>
			) : (
				<p className="text-body-sm text-on-surface-variant">
					Click an element on the device to see its details and add steps.
				</p>
			)}
		</section>
	);
}

function SelectedElementActions({
	selection,
	disabled,
	snippetContext,
	canChangeSelector,
	onChangeSelector,
	onInsert,
	onInsertAndRun,
	onCopyLines,
	onClearSelection,
}: SelectedElementCardProps & { selection: InspectorSelection }) {
	const [view, setView] = useState<PanelView>("main");
	const [flyoutId, setFlyoutId] = useState<SnippetCommandId | null>(null);
	const [prompt, setPrompt] = useState<PromptState | null>(null);
	const [promptValue, setPromptValue] = useState("");
	/** Value committed after the prompt step (input text / wait seconds). */
	const [committedValue, setCommittedValue] = useState<string | null>(null);

	const suggested = useMemo(() => suggestedCommands(selection), [selection]);
	const selector = useMemo(
		() => selectorCommands(selection, snippetContext),
		[selection, snippetContext],
	);

	const openCommand = (snippet: CommandSnippet, from: "main" | "selector") => {
		if (disabled) return;
		setCommittedValue(null);
		if (snippet.needsPrompt) {
			setPrompt({
				commandId: snippet.id,
				kind: snippet.needsPrompt,
				label: snippet.label,
				promptKind: snippet.promptKind,
				returnView: from,
			});
			const initial =
				snippet.needsPrompt === "seconds"
					? "1"
					: snippet.promptKind === "appId"
						? snippetContext.defaultAppId
						: snippet.promptKind === "path"
							? "/tmp/yoqa-screenshot.png"
							: "";
			setPromptValue(initial);
			setView("prompt");
			setFlyoutId(null);
			return;
		}
		setFlyoutId(snippet.id);
		setView(from);
	};

	const confirmPrompt = () => {
		if (!prompt) return;
		const trimmed = promptValue.trim();
		if (prompt.kind === "text" && trimmed.length === 0) return;
		if (prompt.kind === "seconds") {
			const n = Number(trimmed);
			if (!Number.isFinite(n) || n < 0) return;
		}
		setCommittedValue(trimmed);
		setFlyoutId(prompt.commandId);
		setView(prompt.returnView);
		setPrompt(null);
	};

	const activeLines = useMemo(() => {
		if (!flyoutId || prompt) return [];
		return buildCommandLines(selection, flyoutId, committedValue ?? undefined, snippetContext);
	}, [committedValue, flyoutId, prompt, selection, snippetContext]);

	const runAction = (mode: "insert" | "insertRun" | "copy") => {
		if (!flyoutId || activeLines.length === 0 || disabled) return;
		if (mode === "copy") onCopyLines(activeLines);
		else if (mode === "insert") onInsert(activeLines);
		else onInsertAndRun(activeLines);
		setFlyoutId(null);
		onClearSelection();
	};

	const element = selection.element;
	const commandRows = view === "selector" ? selector : suggested;

	return (
		<>
			<dl className="grid grid-cols-2 gap-x-3 gap-y-2">
				<Detail label="Type" value={element?.type ?? "Point"} />
				<Detail label="Label" value={element?.label?.trim() || "—"} />
				<Detail label="Tap point" value={`${selection.x}, ${selection.y}`} />
				<Detail
					label="Visible"
					value={element ? (element.visible === false ? "No" : "Yes") : "—"}
				/>
			</dl>

			{view === "prompt" && prompt ? (
				<div className="flex flex-col gap-2">
					<p className="text-body-sm text-on-surface-variant">{promptHeading(prompt)}</p>
					<TextField className="w-full" value={promptValue} onChange={setPromptValue}>
						<Label className="sr-only">
							{prompt.promptKind === "appId"
								? "App ID"
								: prompt.promptKind === "url"
									? "URL"
									: prompt.promptKind === "path"
										? "Path"
										: prompt.kind === "seconds"
											? "Seconds"
											: "Text"}
						</Label>
						<Input
							placeholder={promptPlaceholder(prompt)}
							inputMode={prompt.kind === "seconds" ? "decimal" : "text"}
							autoFocus
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									event.preventDefault();
									confirmPrompt();
								}
							}}
						/>
					</TextField>
					<div className="flex justify-end gap-1.5">
						<Button
							size="sm"
							variant="tertiary"
							onPress={() => {
								const back = prompt.returnView;
								setPrompt(null);
								setView(back);
							}}
						>
							Cancel
						</Button>
						<Button
							size="sm"
							variant="primary"
							isDisabled={
								prompt.kind === "text"
									? promptValue.trim().length === 0
									: !Number.isFinite(Number(promptValue)) || Number(promptValue) < 0
							}
							onPress={confirmPrompt}
						>
							Continue
						</Button>
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<span className="text-helper font-medium text-on-surface-variant">
							{view === "selector" ? "Selector commands" : "Add step"}
						</span>
						{view === "selector" ? (
							<button
								type="button"
								className="text-helper text-on-surface-variant underline-offset-2 hover:text-on-surface hover:underline"
								onClick={() => {
									setView("main");
									setFlyoutId(null);
								}}
							>
								Back
							</button>
						) : null}
					</div>
					<div className="flex flex-col gap-1.5">
						{commandRows.map((snippet) => (
							<button
								key={snippet.id}
								type="button"
								disabled={disabled}
								aria-pressed={flyoutId === snippet.id}
								className={[
									"flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left font-mono text-helper leading-snug transition-colors disabled:opacity-50",
									flyoutId === snippet.id
										? "border-secondary bg-secondary-container/50"
										: "border-outline-variant/40 bg-surface hover:bg-surface-container",
								].join(" ")}
								onClick={() => {
									openCommand(snippet, view === "selector" ? "selector" : "main");
								}}
							>
								<span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-on-surface">
									{view === "selector" ? snippet.label : snippet.previewLines.join("\n")}
								</span>
								<span className="mt-0.5 shrink-0 text-on-surface-variant">
									{view === "selector" ? <CodeIcon /> : <ChevronIcon />}
								</span>
							</button>
						))}
					</div>

					{flyoutId && activeLines.length > 0 ? (
						<div className="flex flex-wrap gap-1.5">
							<Button
								size="sm"
								variant="primary"
								isDisabled={disabled}
								onPress={() => {
									runAction("insertRun");
								}}
							>
								<PlayIcon /> Insert &amp; Run
							</Button>
							<button
								type="button"
								disabled={disabled}
								className={BTN}
								onClick={() => {
									runAction("insert");
								}}
							>
								<InsertIcon /> Insert
							</button>
							<button
								type="button"
								disabled={disabled}
								className={BTN}
								onClick={() => {
									runAction("copy");
								}}
							>
								<CopyIcon /> Copy
							</button>
						</div>
					) : null}

					{view === "main" ? (
						<div className="flex flex-wrap gap-1.5 border-t border-outline-variant/30 pt-2">
							{canChangeSelector ? (
								<button
									type="button"
									disabled={disabled}
									className={BTN}
									onClick={() => {
										setFlyoutId(null);
										onChangeSelector();
									}}
								>
									<ChangeSelectorIcon /> Change selector
								</button>
							) : null}
							<button
								type="button"
								disabled={disabled}
								className={BTN}
								onClick={() => {
									setView("selector");
									setFlyoutId(null);
								}}
							>
								<ListIcon /> Selector commands
							</button>
						</div>
					) : null}
				</div>
			)}
		</>
	);
}
