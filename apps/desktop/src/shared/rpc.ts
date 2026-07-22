import type { IosToolchainPreferences, IosToolchainSnapshot } from "./ios-toolchain";

export type EnsureLocalServicesResult = {
	baseUrl: string;
	started: boolean;
};

export type DesktopRPC = {
	bun: {
		requests: {
			ping: {
				params: undefined;
				response: string;
			};
			getRunnerBaseUrl: {
				params: undefined;
				response: string;
			};
			ensureLocalServices: {
				params: undefined;
				response: EnsureLocalServicesResult;
			};
			getIosToolchain: {
				params: undefined;
				response: IosToolchainSnapshot;
			};
			setIosToolchainSelection: {
				params: {
					xcodeDeveloperDir?: string | null;
					signingIdentityHash?: string | null;
				};
				response: IosToolchainPreferences;
			};
		};
		messages: {
			log: { msg: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: Record<string, never>;
	};
};
