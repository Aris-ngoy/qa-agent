import { Electroview } from "electrobun/view";
import type {
	CliEnvironmentSnapshot,
	InstallResult,
	InstallSkillResult,
	OpenPathResult,
} from "../../shared/cli-environment";
import type { IosToolchainPreferences, IosToolchainSnapshot } from "../../shared/ios-toolchain";
import type { DesktopRPC, EnsureLocalServicesResult } from "../../shared/rpc";

export type DesktopRpcClient = {
	request: {
		ping: () => Promise<string>;
		getRunnerBaseUrl: () => Promise<string>;
		ensureLocalServices: () => Promise<EnsureLocalServicesResult>;
		getIosToolchain: () => Promise<IosToolchainSnapshot>;
		setIosToolchainSelection: (params: {
			xcodeDeveloperDir?: string | null;
			signingIdentityHash?: string | null;
		}) => Promise<IosToolchainPreferences>;
		getCliEnvironment: () => Promise<CliEnvironmentSnapshot>;
		installCli: () => Promise<InstallResult>;
		installSkill: () => Promise<InstallSkillResult>;
		openSkillFolder: () => Promise<OpenPathResult>;
		openExternalUrl: (params: { url: string }) => Promise<{ ok: boolean }>;
	};
};

/** Open an http(s) URL in the system browser via the Bun host. */
export async function openExternalUrl(url: string): Promise<void> {
	await getDesktopRpc().request.openExternalUrl({ url });
}

const rpc = Electroview.defineRPC<DesktopRPC>({
	maxRequestTime: 60_000,
	handlers: {
		requests: {},
		messages: {},
	},
});

const client = rpc as unknown as DesktopRpcClient;

let started = false;

export function initDesktopRpc(): DesktopRpcClient {
	if (!started) {
		new Electroview({ rpc });
		started = true;
	}
	return client;
}

export function getDesktopRpc(): DesktopRpcClient {
	return initDesktopRpc();
}
