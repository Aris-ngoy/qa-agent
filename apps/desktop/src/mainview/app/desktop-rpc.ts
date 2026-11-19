import { Electroview } from "electrobun/view";
import type { AndroidToolchainSnapshot } from "../../shared/android-toolchain";
import type {
	CliEnvironmentSnapshot,
	InstallResult,
	InstallSkillResult,
	OpenPathResult,
} from "../../shared/cli-environment";
import type { IosToolchainPreferences, IosToolchainSnapshot } from "../../shared/ios-toolchain";
import type { DesktopRPC, EnsureLocalServicesResult, WindowState } from "../../shared/rpc";
import type { YoqaUpdateStatus, YoqaVersionInfo } from "../../shared/yoqa-update";

export type DesktopRpcClient = {
	request: {
		ping: () => Promise<string>;
		getRunnerBaseUrl: () => Promise<string>;
		ensureLocalServices: () => Promise<EnsureLocalServicesResult>;
		stopLocalRunner: () => Promise<{ ok: true }>;
		restartLocalRunner: () => Promise<EnsureLocalServicesResult>;
		getIosToolchain: () => Promise<IosToolchainSnapshot>;
		setIosToolchainSelection: (params: {
			xcodeDeveloperDir?: string | null;
		}) => Promise<IosToolchainPreferences>;
		getAndroidToolchain: () => Promise<AndroidToolchainSnapshot>;
		setAndroidToolchainSelection: (params: {
			sdkRoot?: string | null;
			javaHome?: string | null;
		}) => Promise<AndroidToolchainSnapshot>;
		getCliEnvironment: () => Promise<CliEnvironmentSnapshot>;
		installCli: () => Promise<InstallResult>;
		installSkill: () => Promise<InstallSkillResult>;
		openSkillFolder: () => Promise<OpenPathResult>;
		openExternalUrl: (params: { url: string }) => Promise<{ ok: boolean }>;
		openRemoteDebuggingSetting: (params: { browserId: string }) => Promise<OpenPathResult>;
		bringEverydayBrowserToFront: (params: { browserId: string }) => Promise<OpenPathResult>;
		minimizeWindow: () => Promise<{ ok: true }>;
		toggleMaximizeWindow: () => Promise<WindowState>;
		closeWindow: () => Promise<{ ok: true }>;
		getWindowState: () => Promise<WindowState>;
		getYoqaVersion: () => Promise<YoqaVersionInfo>;
		getYoqaUpdateStatus: () => Promise<YoqaUpdateStatus>;
		checkForYoqaUpdate: () => Promise<YoqaUpdateStatus>;
		restartForYoqaUpdate: () => Promise<{ ok: true }>;
	};
};

/** Open an http(s) URL in the system browser via the Bun host. */
export async function openExternalUrl(url: string): Promise<void> {
	await getDesktopRpc().request.openExternalUrl({ url });
}

const yoqaUpdateListeners = new Set<(status: YoqaUpdateStatus) => void>();

/** Hear every Yoqa update snapshot the Bun host pushes. Returns the unsubscribe. */
export function onYoqaUpdateStatus(listener: (status: YoqaUpdateStatus) => void): () => void {
	yoqaUpdateListeners.add(listener);
	return () => {
		yoqaUpdateListeners.delete(listener);
	};
}

const rpc = Electroview.defineRPC<DesktopRPC>({
	maxRequestTime: 60_000,
	handlers: {
		requests: {},
		messages: {
			yoqaUpdateStatus: (status) => {
				for (const listener of yoqaUpdateListeners) listener(status);
			},
		},
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
