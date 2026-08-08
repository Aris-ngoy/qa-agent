import { Button } from "@heroui/react";

export type RunLogEntry = {
	id: string;
	text: string;
	tone: "info" | "ok" | "error";
};

type RunPanelProps = {
	running: boolean;
	canRun: boolean;
	canSaveAsCase: boolean;
	canExportReport: boolean;
	exportingReport: boolean;
	log: RunLogEntry[];
	onRun: () => void;
	onStop: () => void;
	onCopy: () => void;
	onExport: () => void;
	onExportReportHtml: () => void;
	onExportReportMarkdown: () => void;
	onSaveAsCase: () => void;
};

export function RunPanel({
	running,
	canRun,
	canSaveAsCase,
	canExportReport,
	exportingReport,
	log,
	onRun,
	onStop,
	onCopy,
	onExport,
	onExportReportHtml,
	onExportReportMarkdown,
	onSaveAsCase,
}: RunPanelProps) {
	return (
		<div className="flex flex-col gap-2 border-t border-outline-variant/30 pt-3 pb-2">
			<div className="flex flex-wrap items-center gap-1.5">
				{running ? (
					<Button
						size="sm"
						variant="danger"
						onPress={() => {
							onStop();
						}}
					>
						Stop
					</Button>
				) : (
					<Button
						size="sm"
						variant="primary"
						isDisabled={!canRun}
						onPress={() => {
							onRun();
						}}
					>
						Run script
					</Button>
				)}
				<Button
					size="sm"
					variant="secondary"
					isDisabled={running}
					onPress={() => {
						onCopy();
					}}
				>
					Copy
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={running}
					onPress={() => {
						onExport();
					}}
				>
					Export .sh
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={running || !canExportReport || exportingReport}
					onPress={() => {
						onExportReportHtml();
					}}
				>
					{exportingReport ? "Exporting…" : "Export HTML"}
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={running || !canExportReport || exportingReport}
					onPress={() => {
						onExportReportMarkdown();
					}}
				>
					Export Markdown
				</Button>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={running || !canSaveAsCase}
					onPress={() => {
						onSaveAsCase();
					}}
				>
					Save as test case
				</Button>
			</div>

			<div
				aria-live="polite"
				className="min-h-28 overflow-auto rounded-lg bg-surface-container px-3 py-2 font-mono text-helper leading-relaxed"
			>
				{log.length === 0 ? (
					<p className="text-on-surface-variant">Run log will appear here.</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{log.map((entry) => (
							<li
								key={entry.id}
								className={
									entry.tone === "error"
										? "text-error"
										: entry.tone === "ok"
											? "text-secondary"
											: "text-on-surface-variant"
								}
							>
								{entry.text}
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
