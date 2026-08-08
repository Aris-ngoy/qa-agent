import { getRunnerClient } from "@/app/runner-client";
import { Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProviderModel, UpdateProviderRequest } from "@yoqa/runner-client";
import { useState } from "react";
import { AddProviderModal } from "./add-provider-modal";
import { PROVIDERS_QUERY_KEY } from "./driver-meta";
import { ProviderRow } from "./provider-row";

type ProvidersSectionProps = {
	enabled: boolean;
};

export function ProvidersSection({ enabled }: ProvidersSectionProps) {
	const queryClient = useQueryClient();
	const [addOpen, setAddOpen] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [checkedAt, setCheckedAt] = useState<string | null>(null);
	const [modelsById, setModelsById] = useState<
		Record<string, { models: ProviderModel[]; message: string }>
	>({});
	const [modelsLoadingId, setModelsLoadingId] = useState<string | null>(null);

	const providersQuery = useQuery({
		queryKey: PROVIDERS_QUERY_KEY,
		enabled,
		queryFn: async () => {
			const client = await getRunnerClient();
			return client.listProviders();
		},
		staleTime: 15_000,
	});

	const invalidate = async () => {
		await queryClient.invalidateQueries({ queryKey: PROVIDERS_QUERY_KEY });
	};

	const loadModels = async (id: string) => {
		setModelsLoadingId(id);
		try {
			const client = await getRunnerClient();
			const result = await client.listProviderModels(id);
			setModelsById((prev) => ({
				...prev,
				[id]: { models: result.models, message: result.message },
			}));
		} catch (err) {
			setModelsById((prev) => ({
				...prev,
				[id]: {
					models: [],
					message: err instanceof Error ? err.message : "Failed to load models",
				},
			}));
		} finally {
			setModelsLoadingId(null);
		}
	};

	const refreshMutation = useMutation({
		mutationFn: async () => {
			const client = await getRunnerClient();
			const providers = await client.listProviders();
			for (const provider of providers) {
				if (!provider.enabled) continue;
				try {
					await client.validateProvider(provider.id);
				} catch {
					// Continue checking others.
				}
			}
			return providers;
		},
		onSuccess: async () => {
			setActionError(null);
			setCheckedAt("just now");
			await invalidate();
		},
		onError: (err) => {
			setActionError(err instanceof Error ? err.message : "Failed to refresh providers");
		},
	});

	const updateMutation = useMutation({
		mutationFn: async (input: { id: string; request: UpdateProviderRequest }) => {
			const client = await getRunnerClient();
			return client.updateProvider(input.id, { ...input.request, validate: true });
		},
		onSuccess: async () => {
			setActionError(null);
			await invalidate();
		},
		onError: (err) => {
			setActionError(err instanceof Error ? err.message : "Failed to update provider");
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const client = await getRunnerClient();
			await client.deleteProvider(id);
		},
		onSuccess: async (_, id) => {
			setActionError(null);
			if (expandedId === id) setExpandedId(null);
			await invalidate();
		},
		onError: (err) => {
			setActionError(err instanceof Error ? err.message : "Failed to disconnect provider");
		},
	});

	const defaultMutation = useMutation({
		mutationFn: async (id: string) => {
			const client = await getRunnerClient();
			await client.setDefaultProvider(id);
		},
		onSuccess: async () => {
			setActionError(null);
			await invalidate();
		},
		onError: (err) => {
			setActionError(err instanceof Error ? err.message : "Failed to set default provider");
		},
	});

	const busy =
		refreshMutation.isPending ||
		updateMutation.isPending ||
		deleteMutation.isPending ||
		defaultMutation.isPending;

	const providers = providersQuery.data ?? [];

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">
				Connect AI providers via API keys, tokens, or local CLI auth so Yoqa can run agent tests.
			</p>

			<div className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
				<div className="mb-5 flex items-center justify-between gap-3">
					<div>
						<p className="text-label-caps uppercase tracking-wide text-on-surface-variant">
							Providers
						</p>
						{checkedAt ? (
							<p className="mt-0.5 text-helper text-on-surface-variant">Checked {checkedAt}</p>
						) : null}
					</div>
					<div className="flex items-center gap-1">
						<Button
							aria-label="Add provider"
							isIconOnly
							size="sm"
							variant="ghost"
							onPress={() => setAddOpen(true)}
						>
							+
						</Button>
						<Button
							aria-label="Refresh providers"
							isDisabled={busy}
							isIconOnly
							size="sm"
							variant="ghost"
							onPress={() => void refreshMutation.mutateAsync()}
						>
							↻
						</Button>
					</div>
				</div>

				{providersQuery.isLoading ? (
					<p className="text-body-md text-on-surface-variant">Loading providers…</p>
				) : providersQuery.isError ? (
					<p className="text-body-md text-error">
						Could not load providers. Make sure the local runner is running.
					</p>
				) : providers.length === 0 ? (
					<div className="rounded-xl border border-dashed border-outline-variant px-4 py-8 text-center">
						<p className="text-body-md text-on-surface-variant">
							No provider instances yet. Add Anthropic, OpenAI, Claude, Codex, OpenCode, Cursor,
							Grok, Custom, or others.
						</p>
						<Button className="mt-4" size="sm" variant="primary" onPress={() => setAddOpen(true)}>
							Add provider
						</Button>
					</div>
				) : (
					<div className="flex flex-col gap-2">
						{providers.map((provider) => {
							const modelsState = modelsById[provider.id];
							return (
								<ProviderRow
									key={provider.id}
									busy={busy}
									expanded={expandedId === provider.id}
									models={modelsState?.models ?? []}
									modelsLoading={modelsLoadingId === provider.id}
									modelsMessage={modelsState?.message ?? ""}
									provider={provider}
									onDisconnect={async () => {
										await deleteMutation.mutateAsync(provider.id);
									}}
									onSave={async (input) => {
										await updateMutation.mutateAsync({
											id: provider.id,
											request: {
												label: input.label,
												accentColor: input.accentColor,
												binaryPath: input.binaryPath,
												serverUrl: input.serverUrl,
												baseUrl: input.baseUrl,
												defaultModel: input.defaultModel,
												env: input.env,
												apiKey: input.apiKey,
											},
										});
										await loadModels(provider.id);
									}}
									onSetDefault={async () => {
										await defaultMutation.mutateAsync(provider.id);
									}}
									onToggleEnabled={async (next) => {
										await updateMutation.mutateAsync({
											id: provider.id,
											request: { enabled: next, validate: next },
										});
									}}
									onToggleExpand={() => {
										const next = expandedId === provider.id ? null : provider.id;
										setExpandedId(next);
										if (next) void loadModels(next);
									}}
								/>
							);
						})}
					</div>
				)}

				{actionError ? <p className="mt-4 text-body-sm text-error">{actionError}</p> : null}
			</div>

			<AddProviderModal
				open={addOpen}
				onClose={() => setAddOpen(false)}
				onCreated={async () => {
					setCheckedAt("just now");
					await invalidate();
				}}
			/>
		</div>
	);
}
