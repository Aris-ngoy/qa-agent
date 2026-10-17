import { observable } from "@legendapp/state";

const SELECTED_APP_KEY = "yoqa.selectedAppId";

function readStoredSelectedAppId(): string | null {
	try {
		return localStorage.getItem(SELECTED_APP_KEY);
	} catch {
		return null;
	}
}

function writeStoredSelectedAppId(id: string | null): void {
	try {
		if (id) {
			localStorage.setItem(SELECTED_APP_KEY, id);
		} else {
			localStorage.removeItem(SELECTED_APP_KEY);
		}
	} catch {
		// ignore storage failures in restricted webviews
	}
}

/** The app picked in the side menu, app-wide and kept across launches. */
export const selectedAppId$ = observable<string | null>(readStoredSelectedAppId());

/** Select `id` (or none) and remember it for the next launch. */
export function selectAppId(id: string | null): void {
	selectedAppId$.set(id);
	writeStoredSelectedAppId(id);
}
