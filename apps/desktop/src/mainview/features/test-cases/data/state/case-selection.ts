import { selectedAppId$ } from "@/features/apps/data/state/selected-app";
import { observable } from "@legendapp/state";

/** The test cases ticked for a Run, app-wide: the list, the detail page, and the top bar share it. */
export const selectedCaseIds$ = observable<string[]>([]);

// A selection belongs to one app: switching apps clears it.
selectedAppId$.onChange(() => selectedCaseIds$.set([]));

export function toggleCase(caseId: string): void {
	selectedCaseIds$.set((current) =>
		current.includes(caseId) ? current.filter((id) => id !== caseId) : [...current, caseId],
	);
}

export function setSelectedCases(caseIds: string[]): void {
	selectedCaseIds$.set([...new Set(caseIds)]);
}

export function clearSelectedCases(): void {
	selectedCaseIds$.set([]);
}
