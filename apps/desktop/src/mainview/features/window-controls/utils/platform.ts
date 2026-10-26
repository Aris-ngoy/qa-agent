/**
 * True on Windows, where `titleBarStyle: "hiddenInset"` leaves the window without native
 * caption buttons, so the webview draws its own. macOS keeps its inset traffic lights.
 */
export function needsCustomWindowControls(userAgent: string): boolean {
	return /\bWindows\b/.test(userAgent);
}
