import { Electroview } from "electrobun/view";
import type { IosToolchainPreferences, IosToolchainSnapshot } from "../../shared/ios-toolchain";
import type { DesktopRPC } from "../../shared/rpc";

export type DesktopRpcClient = {
	request: {
		ping: () => Promise<string>;
		getRunnerBaseUrl: () => Promise<string>;
		getIosToolchain: () => Promise<IosToolchainSnapshot>;
		setIosToolchainSelection: (params: {
			xcodeDeveloperDir?: string | null;
			signingIdentityHash?: string | null;
		}) => Promise<IosToolchainPreferences>;
	};
};

const rpc = Electroview.defineRPC<DesktopRPC>({
	maxRequestTime: 30_000,
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
