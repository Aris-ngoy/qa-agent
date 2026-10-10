import { getDesktopRpc } from "@/app/desktop-rpc";
import { getRunnerClient } from "@/app/runner-client";
import type { SelectedDevice } from "@/features/devices/select-device-modal";
import type { SetupPlatformRequest } from "@yoqa/runner-client";

async function resolveIosPhysicalSetup(): Promise<
	Pick<SetupPlatformRequest, "xcodeDeveloperDir" | "developmentTeam" | "codeSignIdentity">
> {
	const toolchain = await getDesktopRpc().request.getIosToolchain();
	const xcodeDeveloperDir = toolchain.preferences.xcodeDeveloperDir;
	if (!xcodeDeveloperDir) {
		throw new Error("No Xcode selected. Open Settings and choose an Xcode installation.");
	}

	const identity =
		(toolchain.preferences.signingIdentityHash &&
			toolchain.identities.find(
				(item) => item.hash === toolchain.preferences.signingIdentityHash,
			)) ||
		toolchain.identities.find((item) => item.tier === "Paid") ||
		toolchain.identities[0] ||
		null;

	if (!identity) {
		throw new Error(
			"No valid Apple Development certificate found. Open Settings, pick a certificate that is not revoked, and try again.",
		);
	}

	return {
		xcodeDeveloperDir,
		developmentTeam: identity.teamId,
		codeSignIdentity: identity.name,
	};
}

/**
 * Force a WebDriverAgent rebuild for an iOS device (setup `--force`). The device's real
 * kind decides the setup: a physical iPhone is signed with the Xcode and certificate from
 * Settings; a simulator needs no signing.
 */
export async function rebuildWebDriverAgent(device: SelectedDevice): Promise<void> {
	const request: SetupPlatformRequest = {
		platform: device.platform,
		deviceId: device.id,
		kind: device.kind,
		force: true,
	};
	if (device.platform === "ios" && device.kind === "physical") {
		Object.assign(request, await resolveIosPhysicalSetup());
	}
	const client = await getRunnerClient();
	await client.setupPlatform(request);
}
