type ScriptEditorProps = {
	value: string;
	onChange: (value: string) => void;
	disabled: boolean;
	activeLineNumber: number | null;
};

export function ScriptEditor({ value, onChange, disabled, activeLineNumber }: ScriptEditorProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-baseline justify-between gap-2">
				<h2 className="text-title-sm font-semibold text-on-surface">Script</h2>
				{activeLineNumber != null ? (
					<span className="text-helper text-secondary">Running line {activeLineNumber}</span>
				) : (
					<span className="text-helper text-on-surface-variant">yoqa action · assert · sleep</span>
				)}
			</div>
			<textarea
				aria-label="YoQA shell script"
				className="min-h-72 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container px-3 py-2.5 font-mono text-body-sm leading-relaxed text-on-surface outline-none transition-colors focus:border-secondary disabled:opacity-60"
				disabled={disabled}
				rows={14}
				spellCheck={false}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}
