import { appendScriptLines } from "@/features/inspector/utils/selection";
import { type Observable, batch } from "@legendapp/state";
import { type RunReportDocument, emptyCaseScriptFile } from "@yoqa/runner-client";

export type RunLogEntry = {
	id: string;
	text: string;
	tone: "info" | "ok" | "error";
};

export type InspectorScriptState = {
	/** The editor's Case Script file (YAML). */
	text: string;
	running: boolean;
	activeLineNumber: number | null;
	log: RunLogEntry[];
	saveOpen: boolean;
	saving: boolean;
	saveError: string | null;
	report: RunReportDocument | null;
	exportingReport: boolean;
};

export type InspectorScript$ = Observable<InspectorScriptState>;

export function initialScriptState(): InspectorScriptState {
	return {
		text: emptyCaseScriptFile(),
		running: false,
		activeLineNumber: null,
		log: [],
		saveOpen: false,
		saving: false,
		saveError: null,
		report: null,
		exportingReport: false,
	};
}

/** Append action lines under `actions:`, restoring the header if the editor was cleared. */
export function appendScript(script$: InspectorScript$, lines: string[]) {
	script$.text.set((prev) => appendScriptLines(prev.trim() ? prev : emptyCaseScriptFile(), lines));
}

export function pushLog(script$: InspectorScript$, entry: RunLogEntry) {
	script$.log.push(entry);
}

/** Running, cleared log, and the first log line land in one notification. */
export function beginRun(
	script$: InspectorScript$,
	options: { resetLog: boolean; clearReport: boolean; entry: RunLogEntry },
) {
	batch(() => {
		script$.running.set(true);
		script$.activeLineNumber.set(null);
		if (options.clearReport) script$.report.set(null);
		const log = options.resetLog ? [] : script$.log.peek();
		script$.log.set([...log, options.entry]);
	});
}

export function finishRun(script$: InspectorScript$) {
	batch(() => {
		script$.running.set(false);
		script$.activeLineNumber.set(null);
	});
}
