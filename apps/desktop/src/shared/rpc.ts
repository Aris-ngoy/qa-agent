import type { AndroidToolchainSnapshot } from "./android-toolchain";
import type {
	CliEnvironmentSnapshot,
	InstallResult,
	InstallSkillResult,
	OpenPathResult,
} from "./cli-environment";
import type { IosToolchainPreferences, IosToolchainSnapshot } from "./ios-toolchain";
import type { YoqaUpdateSettings, YoqaUpdateStatus, YoqaVersionInfo } from "./yoqa-update";

export type EnsureLocalServicesResult = {
	baseUrl: string;
	started: boolean;
};

export type WindowState = {
	maximized: boolean;
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
			/**
			 * Open `chrome://inspect/#remote-debugging` in an Everyday browser (`web-dia-everyday`),
			 * where the user turns remote debugging on. macOS only.
			 */
			openRemoteDebuggingSetting: {
				params: {
					browserId: string;
				};
				response: OpenPathResult;
			};
			/**
			 * Bring an Everyday browser to the front while a connect waits on its Allow prompt.
			 * macOS only.
			 */
			bringEverydayBrowserToFront: {
				params: {
					browserId: string;
				};
				response: OpenPathResult;
			};
			/** Custom window controls (Windows has no inset native ones under `hiddenInset`). */
			minimizeWindow: {
				params: undefined;
				response: { ok: true };
			};
			toggleMaximizeWindow: {
				params: undefined;
				response: WindowState;
			};
			closeWindow: {
				params: undefined;
				response: { ok: true };
			};
			getWindowState: {
				params: undefined;
				response: WindowState;
			};
			/** The installed Yoqa Desktop version and its Electrobun channel. */
			getYoqaVersion: {
				params: undefined;
				response: YoqaVersionInfo;
			};
			/** The Yoqa update controller's snapshot; later changes arrive as `yoqaUpdateStatus`. */
			getYoqaUpdateStatus: {
				params: undefined;
				response: YoqaUpdateStatus;
			};
			/** Start a check now and answer at once; the result arrives as `yoqaUpdateStatus`. */
			checkForYoqaUpdate: {
				params: undefined;
				response: YoqaUpdateStatus;
			};
			/** Apply a ready Yoqa update and relaunch Yoqa. */
			restartForYoqaUpdate: {
				params: undefined;
				response: { ok: true };
			};
			/** The stored Yoqa update settings ("Check for updates automatically"). */
			getYoqaUpdateSettings: {
				params: undefined;
				response: YoqaUpdateSettings;
			};
			/** Store the Yoqa update settings; the schedule follows at once, without a restart. */
			setYoqaUpdateSettings: {
				params: YoqaUpdateSettings;
				response: YoqaUpdateSettings;
			};
		};
		messages: {
			log: { msg: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: {
			/** Pushed by the Yoqa update controller on every change. */
			yoqaUpdateStatus: YoqaUpdateStatus;
		};
	};
};
