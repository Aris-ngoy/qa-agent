import { observable } from "@legendapp/state";

/** The Run the desktop last started or opened, app-wide; the side menu shows when it is live. */
export const activeRunId$ = observable<string | null>(null);

export function setActiveRun(runId: string | null): void {
	activeRunId$.set(runId);
}
