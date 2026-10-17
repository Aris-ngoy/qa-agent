import type { AndroidToolchainSnapshot } from "@/../shared/android-toolchain";
import { getDesktopRpc } from "@/app/desktop-rpc";

export function getIosToolchain() {
	return getDesktopRpc().request.getIosToolchain();
}

export function setIosToolchainSelection(next: { xcodeDeveloperDir?: string | null }) {
	return getDesktopRpc().request.setIosToolchainSelection(next);
}

export function getAndroidToolchain() {
	return getDesktopRpc().request.getAndroidToolchain();
}

/** Save the Android paths, then restart the runner so the Direct lane picks them up. */
export async function saveAndroidToolchain(paths: {
	sdkRoot: string;
	javaHome: string;
}): Promise<AndroidToolchainSnapshot> {
	const next = await getDesktopRpc().request.setAndroidToolchainSelection(paths);
	await getDesktopRpc().request.restartLocalRunner();
	return next;
}

export function getCliEnvironment() {
	return getDesktopRpc().request.getCliEnvironment();
}

export function installCli() {
	return getDesktopRpc().request.installCli();
}

export function installSkill() {
	return getDesktopRpc().request.installSkill();
}

export function openSkillFolder() {
	return getDesktopRpc().request.openSkillFolder();
}
