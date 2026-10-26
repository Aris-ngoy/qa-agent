import type { WindowState } from "@/../shared/rpc";
import { getDesktopRpc } from "@/app/desktop-rpc";

export async function minimizeWindow(): Promise<void> {
	await getDesktopRpc().request.minimizeWindow();
}

export function toggleMaximizeWindow(): Promise<WindowState> {
	return getDesktopRpc().request.toggleMaximizeWindow();
}

export async function closeWindow(): Promise<void> {
	await getDesktopRpc().request.closeWindow();
}

export function getWindowState(): Promise<WindowState> {
	return getDesktopRpc().request.getWindowState();
}
