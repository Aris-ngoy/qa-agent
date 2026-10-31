import type { BrowserProfile, ViewportPresetName } from "@yoqa/runner-client";

/** What the start-a-Run dialog asks of a web Run. */
export type WebRunForm = {
	/** The Viewport preset picked; null until the user picks one, so the session's applies. */
	viewport: ViewportPresetName | null;
	profile: BrowserProfile;
};

export function initialWebRunForm(): WebRunForm {
	return { viewport: null, profile: "kept" };
}
