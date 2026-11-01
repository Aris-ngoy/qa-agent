import {
	type ScriptTokenKind,
	scriptDiagnostics,
	scriptTokens,
} from "@/features/inspector/utils/script-highlight";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { lintGutter, setDiagnostics } from "@codemirror/lint";
import { Annotation, Compartment, EditorState, StateField } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	drawSelection,
	keymap,
	lineNumbers,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

type CaseScriptEditorProps = {
	text: string;
	onChange: (text: string) => void;
	/** Selectable and copyable, but not editable (e.g. while the script runs). */
	readOnly?: boolean;
	/** Case Script file errors; each one with a line is marked on that line. */
	errors?: ReadonlyArray<{ lineNumber: number | null; message: string }>;
	/** Returns true when it handled the paste, so the text is not inserted as typed. */
	onPasteText?: (text: string) => boolean;
	ariaLabel: string;
	className?: string;
};

const KINDS: ScriptTokenKind[] = [
	"comment",
	"action",
	"branch",
	"key",
	"fileKey",
	"number",
	"string",
	"punctuation",
];

const MARKS = Object.fromEntries(
	KINDS.map((kind) => [kind, Decoration.mark({ class: `cm-script-${kind}` })]),
) as Record<ScriptTokenKind, Decoration>;

function decorate(text: string): DecorationSet {
	return Decoration.set(
		scriptTokens(text)
			.filter((token) => token.to > token.from)
			.map((token) => MARKS[token.kind].range(token.from, token.to)),
		true,
	);
}

/** Colours the whole Case Script file on every edit; scripts are small enough to re-read. */
const scriptColours = StateField.define<DecorationSet>({
	create: (state) => decorate(state.doc.toString()),
	update: (value, transaction) =>
		transaction.docChanged ? decorate(transaction.newDoc.toString()) : value,
	provide: (field) => EditorView.decorations.from(field),
});

const theme = EditorView.theme(
	{
		"&": {
			height: "100%",
			backgroundColor: "var(--color-code)",
			color: "var(--color-on-code)",
			fontSize: "var(--text-body-sm)",
		},
		"&.cm-focused": { outline: "none" },
		".cm-scroller": {
			fontFamily: "var(--font-mono)",
			lineHeight: "1.8",
			overflow: "auto",
		},
		".cm-content": { padding: "12px 0", caretColor: "var(--color-on-code)" },
		".cm-line": { padding: "0 14px 0 6px" },
		".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-on-code)" },
		".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
			{ backgroundColor: "var(--color-code-selection)" },
		".cm-gutters": {
			backgroundColor: "var(--color-code)",
			color: "var(--color-code-gutter)",
			border: "none",
		},
		".cm-lineNumbers .cm-gutterElement": { padding: "0 4px 0 12px" },
		".cm-lintRange-error": {
			backgroundImage: "none",
			textDecoration: "underline wavy var(--color-code-error)",
			textUnderlineOffset: "3px",
		},
		".cm-tooltip": {
			backgroundColor: "var(--color-surface-bright)",
			color: "var(--color-on-surface)",
			border: "1px solid var(--color-outline-variant)",
			borderRadius: "8px",
		},
		".cm-script-comment": { color: "var(--color-code-comment)", fontStyle: "italic" },
		".cm-script-action": { color: "var(--color-code-action)", fontWeight: "600" },
		".cm-script-branch": { color: "var(--color-code-branch)", fontWeight: "600" },
		".cm-script-key": { color: "var(--color-code-key)" },
		".cm-script-fileKey": { color: "var(--color-code-file-key)" },
		".cm-script-number": { color: "var(--color-code-number)" },
		".cm-script-string": { color: "var(--color-code-string)" },
		".cm-script-punctuation": { color: "var(--color-code-punctuation)" },
	},
	{ dark: true },
);

function readOnlyExtension(readOnly: boolean) {
	return [
		EditorState.readOnly.of(readOnly),
		EditorView.contentAttributes.of({ "aria-readonly": String(readOnly) }),
	];
}

/** Marks a text change that came from outside the editor, so it is not echoed back. */
const external = Annotation.define<boolean>();

/** A small code editor for a Case Script file: colours by meaning, line numbers, error marks. */
export function CaseScriptEditor({
	text,
	onChange,
	readOnly = false,
	errors = [],
	onPasteText,
	ariaLabel,
	className = "",
}: CaseScriptEditorProps) {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const viewRef = useRef<EditorView | null>(null);
	const readOnlyCompartment = useRef(new Compartment());
	// Latest callbacks for the editor's listeners, which are created once.
	const onChangeRef = useRef(onChange);
	const onPasteTextRef = useRef(onPasteText);
	onChangeRef.current = onChange;
	onPasteTextRef.current = onPasteText;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the editor is created once; later props are synced below.
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const view = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: text,
				extensions: [
					lineNumbers(),
					lintGutter(),
					history(),
					drawSelection(),
					keymap.of([...defaultKeymap, ...historyKeymap]),
					EditorView.lineWrapping,
					readOnlyCompartment.current.of(readOnlyExtension(readOnly)),
					EditorView.contentAttributes.of({
						"aria-label": ariaLabel,
						spellcheck: "false",
						autocorrect: "off",
						autocapitalize: "off",
					}),
					EditorView.domEventHandlers({
						paste: (event) => {
							const pasted = event.clipboardData?.getData("text");
							if (!pasted || !onPasteTextRef.current?.(pasted)) return false;
							event.preventDefault();
							return true;
						},
					}),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged) return;
						if (update.transactions.some((transaction) => transaction.annotation(external))) return;
						onChangeRef.current(update.state.doc.toString());
					}),
					scriptColours,
					theme,
				],
			}),
		});
		viewRef.current = view;
		return () => {
			view.destroy();
			viewRef.current = null;
		};
	}, []);

	useEffect(() => {
		const view = viewRef.current;
		if (!view || view.state.doc.toString() === text) return;
		view.dispatch({
			changes: { from: 0, to: view.state.doc.length, insert: text },
			annotations: external.of(true),
		});
	}, [text]);

	useEffect(() => {
		viewRef.current?.dispatch({
			effects: readOnlyCompartment.current.reconfigure(readOnlyExtension(readOnly)),
		});
	}, [readOnly]);

	useEffect(() => {
		const view = viewRef.current;
		if (!view) return;
		const diagnostics = scriptDiagnostics(view.state.doc.toString(), errors).map((diagnostic) => ({
			...diagnostic,
			severity: "error" as const,
		}));
		view.dispatch(setDiagnostics(view.state, diagnostics));
	}, [errors]);

	return (
		<div
			ref={hostRef}
			className={`overflow-hidden rounded-xl bg-code focus-within:ring-2 focus-within:ring-violet ${className}`}
		/>
	);
}
