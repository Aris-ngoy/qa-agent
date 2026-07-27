import { Button } from "@heroui/react";

export type RunLogEntry = {
	id: string;
	text: string;
	tone: "info" | "ok" | "error";
};

type RunPanelProps = {
	running: boolean;
	canRun: boolean;
	log: RunLogEntry[];
	onRun: () => void;
	onStop: () => void;
	onCopy: () => void;
	onExport: () => void;
};

export function RunPanel({ running, canRun, log, onRun, onStop, onCopy, onExport }: RunPanelProps) {
	return (
		<div className="flex min-h-0 flex-col gap-2 border-t border-outline-variant/30 pt-3">
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
			</div>

			<div
				aria-live="polite"
				className="max-h-40 min-h-24 overflow-auto rounded-lg bg-surface-container px-3 py-2 font-mono text-helper leading-relaxed"
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
