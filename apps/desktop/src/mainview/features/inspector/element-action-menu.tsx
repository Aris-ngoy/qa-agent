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

type ElementActionMenuProps = {
	selection: InspectorSelection;
	/** Anchor box in % of the screenshot image (0–100). */
	anchor: { left: number; top: number; width: number; height: number };
	disabled: boolean;
	snippetContext: SnippetContext;
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

/** Always anchor the menu to the right of the selection; flip vertically near the bottom. */
function menuPosition(anchor: ElementActionMenuProps["anchor"]): {
	left: string;
	top: string;
	transform: string;
} {
	const preferBelow = anchor.top + anchor.height < 70;
	const left = Math.min(92, anchor.left + anchor.width + 2);
	const top = preferBelow
		? Math.min(88, anchor.top + Math.min(anchor.height, 8))
		: Math.max(2, anchor.top - 1.5);
	return {
		left: `${left}%`,
		top: `${top}%`,
		transform: preferBelow ? "translate(0, 0)" : "translate(0, -100%)",
	};
}

function promptHeading(prompt: PromptState): string {
	if (prompt.kind === "seconds") return `Wait seconds for ${prompt.label}`;
	if (prompt.promptKind === "appId") return `App ID for ${prompt.label}`;
	if (prompt.promptKind === "url") return `URL for ${prompt.label}`;
	return `Text for ${prompt.label}`;
}

function promptPlaceholder(prompt: PromptState): string {
	if (prompt.kind === "seconds") return "1";
	if (prompt.promptKind === "appId") return "com.example.app";
	if (prompt.promptKind === "url") return "myapp://path or https://…";
	return "Enter text…";
}

export function ElementActionMenu({
	selection,
	anchor,
	disabled,
	snippetContext,
	onInsert,
	onInsertAndRun,
	onCopyLines,
	onClearSelection,
}: ElementActionMenuProps) {
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

	const position = menuPosition(anchor);

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

	return (
		// Stop selection hit-testing underneath the floating menus.
		// biome-ignore lint/a11y/useKeyWithClickEvents: pointer capture only; menu items are real buttons
		<div
			className="pointer-events-auto absolute z-20 flex items-start gap-1.5"
			style={{ left: position.left, top: position.top, transform: position.transform }}
			onClick={(event) => {
				event.stopPropagation();
			}}
			onDoubleClick={(event) => {
				event.stopPropagation();
			}}
		>
			<div className="w-[17.5rem] overflow-hidden rounded-xl border border-white/10 bg-[#1c1c1e]/95 text-white shadow-[0_18px_50px_-20px_rgba(0,0,0,0.75)] backdrop-blur-md">
				{view === "main" ? (
					<>
						<div className="flex flex-col gap-1.5 p-2">
							{suggested.map((snippet) => (
								<button
									key={snippet.id}
									type="button"
									disabled={disabled}
									className={[
										"flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left font-mono text-[11px] leading-snug transition-colors",
										flyoutId === snippet.id
											? "border-white/25 bg-white/15"
											: "border-white/10 bg-white/5 hover:bg-white/10",
										"disabled:opacity-50",
									].join(" ")}
									onClick={() => {
										openCommand(snippet, "main");
									}}
								>
									<span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-white/90">
										{snippet.previewLines.join("\n")}
									</span>
									<span className="mt-0.5 shrink-0 text-white/45">
										<ChevronIcon />
									</span>
								</button>
							))}
						</div>
						<div className="border-t border-white/10 py-1">
							<button
								type="button"
								disabled={disabled}
								className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-white/90 hover:bg-white/10 disabled:opacity-50"
								onClick={() => {
									setView("selector");
									setFlyoutId(null);
								}}
							>
								<span className="text-white/55">
									<ListIcon />
								</span>
								<span className="flex-1">Selector Commands</span>
								<span className="text-white/45">
									<ChevronIcon />
								</span>
							</button>
							<button
								type="button"
								disabled={disabled}
								className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-white/70 hover:bg-white/10 disabled:opacity-50"
								onClick={() => {
									onClearSelection();
								}}
							>
								<span className="flex-1 pl-[26px]">Clear selection</span>
							</button>
						</div>
					</>
				) : null}

				{view === "selector" ? (
					<>
						<div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
							<button
								type="button"
								className="text-[12px] text-white/60 hover:text-white"
								onClick={() => {
									setView("main");
									setFlyoutId(null);
								}}
							>
								Back
							</button>
							<span className="text-[13px] font-medium text-white/90">Selector Commands</span>
						</div>
						<div className="max-h-64 overflow-y-auto py-1">
							{selector.map((snippet) => (
								<button
									key={snippet.id}
									type="button"
									disabled={disabled}
									className={[
										"flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] hover:bg-white/10 disabled:opacity-50",
										flyoutId === snippet.id ? "bg-white/12" : "",
									].join(" ")}
									onClick={() => {
										openCommand(snippet, "selector");
									}}
								>
									<span className="text-white/55">
										<CodeIcon />
									</span>
									<span className="flex-1 font-mono text-[12px] text-white/90">
										{snippet.label}
									</span>
									<span className="text-white/45">
										<ChevronIcon />
									</span>
								</button>
							))}
						</div>
					</>
				) : null}

				{view === "prompt" && prompt ? (
					<div className="flex flex-col gap-2 p-3">
						<p className="text-[12px] text-white/70">{promptHeading(prompt)}</p>
						<TextField className="w-full" value={promptValue} onChange={setPromptValue}>
							<Label className="sr-only">
								{prompt.promptKind === "appId"
									? "App ID"
									: prompt.promptKind === "url"
										? "URL"
										: prompt.kind === "seconds"
											? "Seconds"
											: "Text"}
							</Label>
							<Input
								className="rounded-lg border border-white/15 bg-black/40 text-white"
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
								className="text-white/80"
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
				) : null}
			</div>

			{flyoutId && activeLines.length > 0 && view !== "prompt" ? (
				<div className="w-44 overflow-hidden rounded-xl border border-white/10 bg-[#1c1c1e]/95 text-white shadow-[0_18px_50px_-20px_rgba(0,0,0,0.75)] backdrop-blur-md">
					<button
						type="button"
						disabled={disabled}
						className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] hover:bg-white/10 disabled:opacity-50"
						onClick={() => {
							runAction("insertRun");
						}}
					>
						<span className="text-white/70">
							<PlayIcon />
						</span>
						Insert &amp; Run
					</button>
					<button
						type="button"
						disabled={disabled}
						className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] hover:bg-white/10 disabled:opacity-50"
						onClick={() => {
							runAction("insert");
						}}
					>
						<span className="text-white/70">
							<InsertIcon />
						</span>
						Insert
					</button>
					<button
						type="button"
						disabled={disabled}
						className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] hover:bg-white/10 disabled:opacity-50"
						onClick={() => {
							runAction("copy");
						}}
					>
						<span className="text-white/70">
							<CopyIcon />
						</span>
						Copy
					</button>
				</div>
			) : null}
		</div>
	);
}
