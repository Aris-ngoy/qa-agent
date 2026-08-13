import type { AndroidToolchainSnapshot } from "./android-toolchain";
import type {
	CliEnvironmentSnapshot,
	InstallResult,
	InstallSkillResult,
	OpenPathResult,
} from "./cli-environment";
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
			stopLocalRunner: {
				params: undefined;
				response: { ok: true };
			};
			restartLocalRunner: {
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
			getAndroidToolchain: {
				params: undefined;
				response: AndroidToolchainSnapshot;
			};
			setAndroidToolchainSelection: {
				params: {
					sdkRoot?: string | null;
					javaHome?: string | null;
				};
				response: AndroidToolchainSnapshot;
			};
			getCliEnvironment: {
				params: undefined;
				response: CliEnvironmentSnapshot;
			};
			installCli: {
				params: undefined;
				response: InstallResult;
			};
			installSkill: {
				params: undefined;
				response: InstallSkillResult;
			};
			openSkillFolder: {
				params: undefined;
				response: OpenPathResult;
			};
			openExternalUrl: {
				params: {
					url: string;
				};
				response: {
					ok: boolean;
				};
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
