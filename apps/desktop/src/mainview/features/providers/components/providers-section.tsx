import { AddProviderModal } from "@/features/providers/components/add-provider-modal";
import { ProviderRow } from "@/features/providers/components/provider-row";
import { listProviderModels } from "@/features/providers/data/api/providers";
import {
	useInvalidateProviders,
	useProviderActions,
	useProvidersQuery,
} from "@/features/providers/hooks/usequery/use-providers";
import { Button } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type { ProviderModel } from "@yoqa/runner-client";

type ProvidersSectionProps = {
	enabled: boolean;
};

export function ProvidersSection({ enabled }: ProvidersSectionProps) {
	const section$ = useObservable({
		addOpen: false,
		expandedId: null as string | null,
		actionError: null as string | null,
		checkedAt: null as string | null,
		modelsById: {} as Record<string, { models: ProviderModel[]; message: string }>,
		modelsLoadingId: null as string | null,
	});
	const addOpen = useValue(section$.addOpen);
	const expandedId = useValue(section$.expandedId);
	const actionError = useValue(section$.actionError);
	const checkedAt = useValue(section$.checkedAt);
	const modelsById = useValue(section$.modelsById);
	const modelsLoadingId = useValue(section$.modelsLoadingId);

	const providersQuery = useProvidersQuery(enabled);
	const invalidate = useInvalidateProviders();

	const setModels = (id: string, entry: { models: ProviderModel[]; message: string }) =>
		section$.modelsById.set((prev) => ({ ...prev, [id]: entry }));

	const loadModels = async (id: string) => {
		section$.modelsLoadingId.set(id);
		try {
			const result = await listProviderModels(id);
			setModels(id, { models: result.models, message: result.message });
		} catch (err) {
			setModels(id, {
				models: [],
				message: err instanceof Error ? err.message : "Failed to load models",
			});
		} finally {
			section$.modelsLoadingId.set(null);
		}
	};

	const { refreshMutation, updateMutation, deleteMutation, defaultMutation } = useProviderActions({
		onSuccess: () => section$.actionError.set(null),
		onError: (message) => section$.actionError.set(message),
		onRefreshed: () => section$.checkedAt.set("just now"),
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
							onPress={() => section$.addOpen.set(true)}
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
						<Button
							className="mt-4"
							size="sm"
							variant="primary"
							onPress={() => section$.addOpen.set(true)}
						>
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
										if (section$.expandedId.peek() === provider.id) section$.expandedId.set(null);
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
										section$.expandedId.set(next);
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
				onClose={() => section$.addOpen.set(false)}
				onCreated={async () => {
					section$.checkedAt.set("just now");
					await invalidate();
				}}
			/>
		</div>
	);
}
