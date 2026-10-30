import { showErrorToast } from "@/app/show-error-toast";
import {
	listAllDevices,
	listPlatformDevices,
	openRemoteDebuggingSetting,
	resetBrowserProfile,
} from "@/features/devices/data/api/devices";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import type { Device, DevicePlatform } from "@yoqa/runner-client";

/** Query key for a platform's device list, shared by the picker and the session bar. */
export function platformDevicesQueryKey(platform: DevicePlatform) {
	return ["devices", platform] as const;
}

/** Query key for the device lists that name a Run's device (runs, settings). */
export function devicesQueryKey(platform: DevicePlatform | "all") {
	return ["devices", platform, "include-unavailable"] as const;
}

/** The session bar's list: cached for 30 s, so a page change does not rescan. */
export function usePlatformDevices(platform: DevicePlatform) {
	return useQuery({
		queryKey: platformDevicesQueryKey(platform),
		queryFn: () => listPlatformDevices(platform),
		staleTime: 30_000,
	});
}

/** The picker's list: rescanned each time it opens and when the window regains focus. */
export function usePickerDevices(platform: DevicePlatform, open: boolean) {
	return useQuery({
		queryKey: platformDevicesQueryKey(platform),
		queryFn: () => listPlatformDevices(platform),
		enabled: open,
		refetchOnWindowFocus: true,
		refetchOnMount: "always",
		staleTime: 5_000,
	});
}

function listedDevicesQueryOptions(platform: DevicePlatform | "all" | null | undefined) {
	return queryOptions({
		queryKey: platform ? devicesQueryKey(platform) : ["devices", "pending"],
		queryFn: (): Promise<Device[]> => {
			if (!platform) return Promise.resolve([]);
			return platform === "all" ? listAllDevices() : listPlatformDevices(platform);
		},
		staleTime: 30_000,
	});
}

/** Devices to name a Run's device by: one platform, every platform, or none yet. */
export function useListedDevices(
	platform: DevicePlatform | "all" | null | undefined,
	options: { enabled?: boolean } = {},
) {
	return useQuery({
		...listedDevicesQueryOptions(platform),
		enabled: Boolean(platform) && (options.enabled ?? true),
	});
}

/** The cached device list, kept current but never fetched here: the run views load it. */
export function useCachedListedDevices(platform: DevicePlatform | "all" | null | undefined) {
	return useQuery({ ...listedDevicesQueryOptions(platform), enabled: false }).data;
}

/**
 * Delete a browser's Kept profile. Nothing cached holds a profile, so there is nothing to
 * update; the caller shows the result and the runner's refusal while the browser is open.
 */
export function useResetBrowserProfile() {
	return useMutation({ mutationFn: resetBrowserProfile });
}

/** Open an Everyday browser's remote-debugging setting; the picker rescans when the window regains focus. */
export function useOpenRemoteDebuggingSetting() {
	return useMutation({
		mutationFn: openRemoteDebuggingSetting,
		onError: (error) => showErrorToast(error, "Could not open the setting"),
	});
}
