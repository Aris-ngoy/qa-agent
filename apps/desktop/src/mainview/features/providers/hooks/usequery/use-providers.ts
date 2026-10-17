import {
	createProvider,
	deleteProvider,
	listProviderCatalog,
	listProviders,
	probeProvider,
	setDefaultProvider,
	updateProvider,
	validateEnabledProviders,
} from "@/features/providers/data/api/providers";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UpdateProviderRequest } from "@yoqa/runner-client";

export const PROVIDERS_QUERY_KEY = ["ai-providers"] as const;
export const PROVIDER_CATALOG_QUERY_KEY = [...PROVIDERS_QUERY_KEY, "catalog"] as const;

export function useProvidersQuery(enabled: boolean) {
	return useQuery({
		queryKey: PROVIDERS_QUERY_KEY,
		enabled,
		queryFn: listProviders,
		staleTime: 15_000,
	});
}

export function useProviderDriverCatalog(enabled = true) {
	return useQuery({
		queryKey: PROVIDER_CATALOG_QUERY_KEY,
		enabled,
		queryFn: listProviderCatalog,
		staleTime: 60_000,
	});
}

export function useInvalidateProviders() {
	const queryClient = useQueryClient();
	return () => queryClient.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY });
}

type ActionCallbacks = {
	onSuccess: () => void;
	onError: (message: string) => void;
};

function errorText(error: unknown, fallback: string): string {
	return error instanceof Error ? error.message : fallback;
}

/** Refresh, update, disconnect, and make-default, each refreshing the list when it works. */
export function useProviderActions(callbacks: ActionCallbacks & { onRefreshed: () => void }) {
	const invalidate = useInvalidateProviders();
	const done = async () => {
		callbacks.onSuccess();
		await invalidate();
	};

	const refreshMutation = useMutation({
		mutationFn: validateEnabledProviders,
		onSuccess: async () => {
			callbacks.onRefreshed();
			await done();
		},
		onError: (error) => callbacks.onError(errorText(error, "Failed to refresh providers")),
	});

	const updateMutation = useMutation({
		mutationFn: (input: { id: string; request: UpdateProviderRequest }) =>
			updateProvider(input.id, input.request),
		onSuccess: done,
		onError: (error) => callbacks.onError(errorText(error, "Failed to update provider")),
	});

	const deleteMutation = useMutation({
		mutationFn: deleteProvider,
		onSuccess: done,
		onError: (error) => callbacks.onError(errorText(error, "Failed to disconnect provider")),
	});

	const defaultMutation = useMutation({
		mutationFn: setDefaultProvider,
		onSuccess: done,
		onError: (error) => callbacks.onError(errorText(error, "Failed to set default provider")),
	});

	return { refreshMutation, updateMutation, deleteMutation, defaultMutation };
}

export function useProbeProvider() {
	return useMutation({ mutationFn: probeProvider });
}

export function useCreateProvider(callbacks: {
	onSuccess: () => Promise<void>;
	onError: (message: string) => void;
}) {
	return useMutation({
		mutationFn: createProvider,
		onSuccess: callbacks.onSuccess,
		onError: (error) => callbacks.onError(errorText(error, "Failed to create provider")),
	});
}
