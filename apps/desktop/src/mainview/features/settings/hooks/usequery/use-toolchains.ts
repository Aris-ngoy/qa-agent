import type { AndroidToolchainSnapshot } from "@/../shared/android-toolchain";
import type { CliEnvironmentSnapshot } from "@/../shared/cli-environment";
import type { IosToolchainSnapshot } from "@/../shared/ios-toolchain";
import {
	getAndroidToolchain,
	getCliEnvironment,
	getIosToolchain,
	installCli,
	installSkill,
	openSkillFolder,
	saveAndroidToolchain,
	setIosToolchainSelection,
} from "@/features/settings/data/api/toolchains";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const IOS_TOOLCHAIN_QUERY_KEY = ["ios-toolchain"] as const;
const ANDROID_TOOLCHAIN_QUERY_KEY = ["android-toolchain"] as const;
const CLI_ENVIRONMENT_QUERY_KEY = ["cli-environment"] as const;

export function useIosToolchain(enabled: boolean) {
	return useQuery({
		queryKey: IOS_TOOLCHAIN_QUERY_KEY,
		enabled,
		queryFn: getIosToolchain,
		staleTime: 30_000,
	});
}

/** Save the Xcode choice and write the stored preferences into the snapshot. */
export function useSetIosToolchain() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: setIosToolchainSelection,
		onSuccess: (preferences) => {
			queryClient.setQueryData<IosToolchainSnapshot>(IOS_TOOLCHAIN_QUERY_KEY, (current) =>
				current ? { ...current, preferences } : current,
			);
		},
	});
}

export function useAndroidToolchain(enabled: boolean) {
	return useQuery({
		queryKey: ANDROID_TOOLCHAIN_QUERY_KEY,
		enabled,
		queryFn: getAndroidToolchain,
		staleTime: 10_000,
	});
}

export function useSaveAndroidToolchain(options: {
	onSuccess: () => void;
	onError: (error: unknown) => void;
}) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: saveAndroidToolchain,
		onSuccess: (next) => {
			queryClient.setQueryData<AndroidToolchainSnapshot>(ANDROID_TOOLCHAIN_QUERY_KEY, next);
			options.onSuccess();
		},
		onError: options.onError,
	});
}

export function useCliEnvironment(enabled: boolean) {
	return useQuery({
		queryKey: CLI_ENVIRONMENT_QUERY_KEY,
		enabled,
		queryFn: getCliEnvironment,
		staleTime: 10_000,
	});
}

/** The CLI, skill, and folder actions; each reports its own error (`null` once it works). */
export function useCliActions(report: {
	cli: (error: string | null) => void;
	skill: (error: string | null) => void;
	open: (error: string | null) => void;
}) {
	const queryClient = useQueryClient();
	const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

	const installCliMutation = useMutation({
		mutationFn: installCli,
		onSuccess: (result) => {
			if (!result.ok) {
				report.cli(result.error);
				return;
			}
			report.cli(null);
			void queryClient.invalidateQueries({ queryKey: CLI_ENVIRONMENT_QUERY_KEY });
		},
		onError: (error) => report.cli(message(error)),
	});

	const installSkillMutation = useMutation({
		mutationFn: installSkill,
		onSuccess: (result) => {
			if (!result.ok) {
				report.skill(result.error);
				return;
			}
			report.skill(null);
			queryClient.setQueryData<CliEnvironmentSnapshot>(CLI_ENVIRONMENT_QUERY_KEY, (current) => {
				if (!current) return current;
				return {
					...current,
					skill: {
						...current.skill,
						installed: true,
						installDir: result.installDir,
						targets: result.targets,
					},
				};
			});
		},
		onError: (error) => report.skill(message(error)),
	});

	const openFolderMutation = useMutation({
		mutationFn: openSkillFolder,
		onSuccess: (result) => report.open(result.ok ? null : result.error),
		onError: (error) => report.open(message(error)),
	});

	return { installCliMutation, installSkillMutation, openFolderMutation };
}
