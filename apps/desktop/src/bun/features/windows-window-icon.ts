import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const WM_SETICON = 0x0080;
const ICON_SMALL = 0;
const ICON_BIG = 1;
const IMAGE_ICON = 1;
const LR_LOADFROMFILE = 0x0010;
const SM_CXICON = 11;
const SM_CXSMICON = 49;

/** electrobun copies `build.win.icon` to `<app>/Resources/app.ico`, next to `bin/bun.exe`. */
export function packagedWindowIconPath(execPath: string = process.execPath): string {
	return join(dirname(execPath), "..", "Resources", "app.ico");
}

/**
 * Give this process's top-level windows the app icon (Windows only).
 *
 * electrobun never sends `WM_SETICON`, so the taskbar and Alt+Tab fall back to an icon
 * Windows has cached for `bun.exe`, which stays Bun's even after the exe is re-iconed.
 * Returns how many windows got the icon; 0 when there is nothing to do or it failed.
 */
export async function applyWindowsWindowIcon(iconPath = packagedWindowIconPath()): Promise<number> {
	if (process.platform !== "win32" || !existsSync(iconPath)) return 0;
	try {
		const { dlopen, FFIType, ptr } = await import("bun:ffi");
		const user32 = dlopen("user32.dll", {
			FindWindowExW: {
				args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
				returns: FFIType.ptr,
			},
			GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
			IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
			GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
			LoadImageW: {
				args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.i32, FFIType.i32, FFIType.u32],
				returns: FFIType.ptr,
			},
			SendMessageW: {
				args: [FFIType.ptr, FFIType.u32, FFIType.u64, FFIType.ptr],
				returns: FFIType.ptr,
			},
		});
		const { symbols } = user32;

		const widePath = Buffer.from(`${iconPath}\0`, "utf16le");
		const load = (metric: number) => {
			const size = symbols.GetSystemMetrics(metric);
			return symbols.LoadImageW(null, ptr(widePath), IMAGE_ICON, size, size, LR_LOADFROMFILE);
		};
		const bigIcon = load(SM_CXICON);
		const smallIcon = load(SM_CXSMICON);
		if (!bigIcon || !smallIcon) return 0;

		const ownerPid = new Uint32Array(1);
		let applied = 0;
		let hwnd = symbols.FindWindowExW(null, null, null, null);
		while (hwnd) {
			symbols.GetWindowThreadProcessId(hwnd, ptr(ownerPid));
			if (ownerPid[0] === process.pid && symbols.IsWindowVisible(hwnd)) {
				symbols.SendMessageW(hwnd, WM_SETICON, ICON_BIG, bigIcon);
				symbols.SendMessageW(hwnd, WM_SETICON, ICON_SMALL, smallIcon);
				applied++;
			}
			hwnd = symbols.FindWindowExW(null, hwnd, null, null);
		}
		return applied;
	} catch (error) {
		console.warn("[yoqa desktop] could not set the window icon:", error);
		return 0;
	}
}
