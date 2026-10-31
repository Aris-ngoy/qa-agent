import { isEverydayDeviceId } from "@/features/devices/utils/everyday-browser";
import type { WebRunForm } from "@/features/runs/data/state/web-run-form";
import {
	type ActiveDeviceResponse,
	type CreateRunRequest,
	DEFAULT_VIEWPORT_PRESET,
	type DevicePlatform,
	type ViewportPresetName,
} from "@yoqa/runner-client";

/** The device a Run starts on: the Active Session's, or the one picked in the top bar. */
type RunDevice = { id: string; platform: DevicePlatform };

/**
 * The Viewport preset a web Run asks for: the one picked, else the Active Session's when it
 * is on that device, else desktop.
 */
export function runViewport(
	form: WebRunForm,
	device: RunDevice,
	session: ActiveDeviceResponse | null,
): ViewportPresetName {
	if (form.viewport) return form.viewport;
	if (session?.platform === "web" && session.deviceId === device.id && session.viewport) {
		return session.viewport;
	}
	return DEFAULT_VIEWPORT_PRESET;
}

/**
 * Whether the dialog offers Kept or Clean: a browser Yoqa launches does, the Everyday
 * browser runs on the user's own profile (ADR-0009), and a phone has none.
 */
export function showsProfileChoice(device: RunDevice): boolean {
	return device.platform === "web" && !isEverydayDeviceId(device.id);
}

/**
 * The web part of a Run's request: its preset, and `profile: clean` when picked. Kept sends
 * no profile, so a case asking for `profile: clean` still makes the Run clean, as with no
 * `yoqa runs create --profile`. Nothing for a phone.
 */
export function webRunRequest(
	form: WebRunForm,
	device: RunDevice,
	session: ActiveDeviceResponse | null,
): Pick<CreateRunRequest, "viewport" | "profile"> {
	if (device.platform !== "web") return {};
	return {
		viewport: runViewport(form, device, session),
		...(form.profile === "clean" && showsProfileChoice(device) ? { profile: "clean" } : {}),
	};
}
