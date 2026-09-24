import { RhfTextField } from "@/app/forms";
import { Accordion, Button, Form, Modal, Spinner } from "@heroui/react";
import type { AiProvider, ProviderAccentColor, ProviderModel } from "@yoqa/runner-client";
import { type SVGProps, useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ACCENT_COLORS, fieldInputClass, useDriverMeta } from "./driver-meta";

function CheckIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			height="12"
			viewBox="0 0 12 12"
			width="12"
			xmlns="http://www.w3.org/2000/svg"
			{...props}
		>
			<path
				d="M2.5 6.2 4.8 8.5 9.5 3.5"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.75"
			/>
		</svg>
	);
}

type EnvRow = { id: string; key: string; value: string };

function newEnvRow(key = "", value = ""): EnvRow {
	return { id: crypto.randomUUID(), key, value };
}

type ProviderExpandedProps = {
	provider: AiProvider;
	models: ProviderModel[];
	modelsMessage: string;
	modelsLoading: boolean;
	busy: boolean;
	onSave: (input: {
		label: string;
		accentColor: ProviderAccentColor;
		binaryPath: string | null;
		serverUrl: string | null;
		baseUrl: string | null;
		defaultModel: string | null;
		env?: Record<string, string>;
		apiKey?: string;
	}) => Promise<void>;
	onDisconnect: () => Promise<void>;
	onSetDefault: () => Promise<void>;
};

type FormValues = {
	label: string;
	accentColor: ProviderAccentColor;
	binaryPath: string;
	serverUrl: string;
	baseUrl: string;
	defaultModel: string;
	apiKey: string;
	envRows: EnvRow[];
};

/** Used when the OpenCode catalog has not loaded yet so the user can still pick a Zen model. */
const OPENCODE_FALLBACK_MODELS: ProviderModel[] = [
	{ id: "mimo-v2.5-free", name: "MiMo V2.5 Free", provider: "OpenCode Zen" },
	{ id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", provider: "OpenCode Zen" },
	{ id: "big-pickle", name: "Big Pickle", provider: "OpenCode Zen" },
	{ id: "laguna-s-2.1-free", name: "Laguna S 2.1 Free", provider: "OpenCode Zen" },
	{ id: "north-mini-code-free", name: "North Mini Code Free", provider: "OpenCode Zen" },
	{ id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", provider: "OpenCode Zen" },
];

const OPENCODE_ZEN_PROVIDER = "OpenCode Zen";

/** Hint: most Zen free models are text-only; mimo-v2.5-free accepts screenshots. */
const OPENCODE_VISION_HINT =
	"Yoqa sends Zen screenshots through OpenCode Zen. Prefer mimo-v2.5-free — deepseek-v4-flash-free, big-pickle, and most other Zen free models are text-only. LiteLLM models use your OpenCode gateway instead.";

const OPENCODE_LITELLM_VISION_HINT =
	"Screenshot runs go through your OpenCode LiteLLM gateway (opencode.json + CLI auth or LITELLM_API_KEY). Yoqa does not send LiteLLM models to OpenCode Zen.";

const OPENCODE_OTHER_PROVIDER_VISION_HINT =
	"Amazon Bedrock, Copilot, and similar CLI providers are listed for browsing. Vision currently supports OpenCode Zen and LiteLLM — pick one of those for screenshot runs.";

function parseOpenCodeSlug(slug: string): { providerId: string; modelId: string } {
	const trimmed = slug.trim();
	const sep = trimmed.indexOf("/");
	if (sep <= 0 || sep === trimmed.length - 1) {
		return { providerId: "opencode", modelId: trimmed };
	}
	return { providerId: trimmed.slice(0, sep), modelId: trimmed.slice(sep + 1) };
}

function openCodeModelIdsMatch(selected: string, catalogId: string): boolean {
	if (selected.trim() === catalogId.trim()) return true;
	const a = parseOpenCodeSlug(selected);
	const b = parseOpenCodeSlug(catalogId);
	return a.providerId === b.providerId && a.modelId === b.modelId;
}

function groupModelsByProvider(models: ProviderModel[]): Array<{
	id: string;
	label: string;
	models: ProviderModel[];
}> {
	const buckets = new Map<string, ProviderModel[]>();
	for (const model of models) {
		const label = model.provider?.trim() || OPENCODE_ZEN_PROVIDER;
		const existing = buckets.get(label);
		if (existing) {
			existing.push(model);
		} else {
			buckets.set(label, [model]);
		}
	}
	return [...buckets.entries()]
		.sort(([a], [b]) => {
			if (a === OPENCODE_ZEN_PROVIDER && b !== OPENCODE_ZEN_PROVIDER) return -1;
			if (b === OPENCODE_ZEN_PROVIDER && a !== OPENCODE_ZEN_PROVIDER) return 1;
			return a.localeCompare(b);
		})
		.map(([label, grouped]) => ({ id: label, label, models: grouped }));
}

function ModelPickList({
	groups,
	flatModels,
	selectedId,
	disabled,
	loading,
	emptyMessage,
	onPick,
}: {
	groups?: Array<{ id: string; label: string; models: ProviderModel[] }>;
	flatModels?: ProviderModel[];
	selectedId: string;
	disabled: boolean;
	loading?: boolean;
	emptyMessage: string;
	onPick: (modelId: string) => void;
}) {
	const renderModelRow = (model: ProviderModel) => {
		const selected = selectedId.trim() === model.id || openCodeModelIdsMatch(selectedId, model.id);
		return (
			<button
				aria-pressed={selected}
				className={[
					"flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
					"disabled:cursor-not-allowed disabled:opacity-50",
					selected
						? "bg-primary/10 text-on-surface"
						: "text-on-surface hover:bg-surface-container-low",
				].join(" ")}
				disabled={disabled}
				key={model.id}
				type="button"
				onClick={() => {
					if (disabled) return;
					onPick(model.id);
				}}
			>
				<span
					aria-hidden="true"
					className={[
						"flex size-5 shrink-0 items-center justify-center rounded-full border",
						selected
							? "border-primary bg-primary text-on-primary"
							: "border-outline-variant bg-transparent text-transparent",
					].join(" ")}
				>
					<CheckIcon />
				</span>
				<span className="flex min-w-0 flex-1 items-center justify-between gap-2">
					<span
						className={[
							"min-w-0 flex-1 truncate text-body-sm",
							selected ? "font-semibold" : "font-normal",
						].join(" ")}
					>
						{model.name}
					</span>
					{model.name !== model.id ? (
						<span className="shrink-0 font-mono text-helper text-on-surface-variant">
							{model.id}
						</span>
					) : null}
				</span>
			</button>
		);
	};

	const hasGrouped = (groups?.length ?? 0) > 0;
	const hasFlat = (flatModels?.length ?? 0) > 0;
	const hasAny = hasGrouped || hasFlat;
	const expandedKeys = new Set<string>();
	const selectedGroup = groups?.find((group) =>
		group.models.some((model) => openCodeModelIdsMatch(selectedId, model.id)),
	);
	if (selectedGroup) {
		expandedKeys.add(selectedGroup.id);
	} else if (groups?.some((group) => group.id === OPENCODE_ZEN_PROVIDER)) {
		expandedKeys.add(OPENCODE_ZEN_PROVIDER);
	} else if (groups?.[0]) {
		expandedKeys.add(groups[0].id);
	}

	return (
		<div className="max-h-[min(28rem,50vh)] min-h-40 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
			{loading ? (
				<div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-8">
					<Spinner aria-label="Loading models" color="accent" size="md" />
					<p className="text-body-sm text-on-surface-variant">Fetching models…</p>
				</div>
			) : !hasAny ? (
				<p className="px-3 py-8 text-center text-body-sm text-on-surface-variant">{emptyMessage}</p>
			) : hasGrouped ? (
				<Accordion defaultExpandedKeys={expandedKeys} key={[...expandedKeys].join("|")}>
					{groups?.map((group) => (
						<Accordion.Item id={group.id} key={group.id}>
							<Accordion.Heading>
								<Accordion.Trigger>
									{group.label} ({group.models.length})
								</Accordion.Trigger>
							</Accordion.Heading>
							<Accordion.Panel className="p-0">
								<div className="divide-y divide-outline-variant">
									{group.models.map(renderModelRow)}
								</div>
							</Accordion.Panel>
						</Accordion.Item>
					))}
				</Accordion>
			) : (
				<div className="divide-y divide-outline-variant">{flatModels?.map(renderModelRow)}</div>
			)}
		</div>
	);
}

function formFromProvider(
	provider: AiProvider,
	defaultBinary: string | null | undefined,
): FormValues {
	return {
		label: provider.label,
		accentColor: provider.accentColor,
		binaryPath: provider.binaryPath ?? defaultBinary ?? "",
		serverUrl: provider.serverUrl ?? "",
		baseUrl: provider.baseUrl ?? "",
		defaultModel: provider.defaultModel ?? "",
		apiKey: "",
		envRows: provider.envKeys.map((key) => newEnvRow(key)),
	};
}

export function ProviderExpanded({
	provider,
	models,
	modelsMessage,
	modelsLoading,
	busy,
	onSave,
	onDisconnect,
	onSetDefault,
}: ProviderExpandedProps) {
	const meta = useDriverMeta(provider.kind);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selectingModel, setSelectingModel] = useState(false);
	const [modelDialogOpen, setModelDialogOpen] = useState(false);

	const { control, handleSubmit, reset, getValues, setValue } = useForm<FormValues>({
		defaultValues: formFromProvider(provider, meta.defaultBinary),
		mode: "onChange",
	});

	const {
		fields: envFields,
		append,
		remove,
	} = useFieldArray({
		control,
		name: "envRows",
		keyName: "fieldId",
	});

	const label = useWatch({ control, name: "label" }) ?? "";
	const accentColor = useWatch({ control, name: "accentColor" });
	const defaultModel = useWatch({ control, name: "defaultModel" }) ?? "";

	const isOpenCode = provider.kind === "opencode";
	const envKeysKey = provider.envKeys.join("\0");
	const catalogModels = useMemo(() => {
		if (models.length > 0) return models;
		if (isOpenCode && !modelsLoading) return OPENCODE_FALLBACK_MODELS;
		return models;
	}, [isOpenCode, models, modelsLoading]);

	const modelGroups = useMemo(() => groupModelsByProvider(catalogModels), [catalogModels]);
	const selectedProviderLabel = useMemo(() => {
		if (!isOpenCode || !defaultModel.trim()) return null;
		const match = catalogModels.find((model) => openCodeModelIdsMatch(defaultModel, model.id));
		if (match?.provider?.trim()) return match.provider.trim();
		const { providerId } = parseOpenCodeSlug(defaultModel);
		if (providerId === "opencode") return OPENCODE_ZEN_PROVIDER;
		return providerId
			.split(/[-_]/)
			.filter(Boolean)
			.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
			.join(" ");
	}, [catalogModels, defaultModel, isOpenCode]);

	// Sync from server only when this provider instance or its saved fields change —
	// never on every new object reference from React Query (that wiped local selection).
	// biome-ignore lint/correctness/useExhaustiveDependencies: envKeysKey is the stable trigger for env key list
	useEffect(() => {
		reset(formFromProvider(provider, meta.defaultBinary));
		setError(null);
	}, [
		provider.label,
		provider.accentColor,
		provider.binaryPath,
		provider.serverUrl,
		provider.baseUrl,
		provider.defaultModel,
		envKeysKey,
		meta.defaultBinary,
		provider,
		reset,
	]);

	const persist = async (overrides?: {
		defaultModel?: string | null;
		apiKey?: string;
		env?: Record<string, string>;
	}) => {
		const values = getValues();
		const env: Record<string, string> = {};
		for (const row of values.envRows) {
			const key = row.key.trim();
			if (!key) continue;
			if (row.value.trim()) {
				env[key] = row.value.trim();
			}
		}
		const hasNewEnvValues = Object.keys(env).length > 0;
		const nextModel =
			overrides && "defaultModel" in overrides
				? (overrides.defaultModel ?? null)
				: values.defaultModel.trim() || null;
		if (provider.kind === "custom" && !values.baseUrl.trim()) {
			throw new Error("Base URL is required for a custom provider");
		}
		await onSave({
			label: values.label.trim() || meta.label,
			accentColor: values.accentColor,
			binaryPath: values.binaryPath.trim() || null,
			serverUrl: values.serverUrl.trim() || null,
			baseUrl: values.baseUrl.trim() || null,
			defaultModel: nextModel,
			...(overrides?.env ? { env: overrides.env } : hasNewEnvValues ? { env } : {}),
			apiKey: overrides?.apiKey ?? (values.apiKey.trim() || undefined),
		});
	};

	const onSubmit = async () => {
		setSaving(true);
		setError(null);
		try {
			await persist();
			setValue("apiKey", "");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save");
		} finally {
			setSaving(false);
		}
	};

	const handlePickModel = async (modelId: string) => {
		setValue("defaultModel", modelId, { shouldDirty: true });
		if (!isOpenCode) return;

		setSelectingModel(true);
		setError(null);
		try {
			await persist({ defaultModel: modelId });
			setValue("apiKey", "");
			setModelDialogOpen(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save model");
		} finally {
			setSelectingModel(false);
		}
	};

	const modelListBusy = busy || saving || selectingModel;

	const modelStatusHint = modelsLoading
		? isOpenCode
			? "Loading catalog…"
			: "Loading…"
		: isOpenCode
			? models.length > 0
				? modelsMessage
				: "Showing OpenCode Zen defaults (catalog unavailable)"
			: modelsMessage || "Pick from the list or type an id";

	const modelPickerSummary = (
		<div>
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-body-sm font-semibold text-on-surface">Default model</p>
				<p className="text-helper text-on-surface-variant">{modelStatusHint}</p>
			</div>
			<div className="mt-2 flex items-center gap-3">
				<p className="min-w-0 flex-1 truncate text-body-sm text-on-surface">
					{defaultModel ? (
						<>
							Current: <span className="font-semibold">{defaultModel}</span>
							{selectingModel ? " · Saving…" : ""}
						</>
					) : (
						<span className="text-on-surface-variant">No model selected</span>
					)}
				</p>
				<Button
					isDisabled={modelListBusy}
					size="sm"
					type="button"
					variant="secondary"
					onPress={() => setModelDialogOpen(true)}
				>
					Choose model
				</Button>
			</div>
			{isOpenCode ? (
				<p className="mt-1.5 text-helper text-on-surface-variant">
					{selectedProviderLabel === "LiteLLM" ||
					parseOpenCodeSlug(defaultModel).providerId === "litellm"
						? OPENCODE_LITELLM_VISION_HINT
						: selectedProviderLabel && selectedProviderLabel !== OPENCODE_ZEN_PROVIDER
							? OPENCODE_OTHER_PROVIDER_VISION_HINT
							: OPENCODE_VISION_HINT}
				</p>
			) : null}
		</div>
	);

	const modelPickerDialog = (
		<Modal>
			<Modal.Backdrop isOpen={modelDialogOpen} onOpenChange={setModelDialogOpen} variant="opaque">
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="max-h-[min(36rem,90vh)] overflow-hidden sm:max-w-xl">
						<Modal.CloseTrigger />
						<Modal.Header className="flex flex-col gap-1">
							<Modal.Heading>Choose default model</Modal.Heading>
							<p className="text-body-sm text-on-surface-variant">
								{isOpenCode
									? "Grouped by OpenCode provider. Vision runs support OpenCode Zen and LiteLLM; selection saves immediately."
									: "Pick a catalog model or enter a custom id, then save the provider."}
							</p>
						</Modal.Header>
						<Modal.Body className="gap-4">
							{isOpenCode ? (
								<ModelPickList
									disabled={modelListBusy}
									emptyMessage="No models listed yet. Add an API key or server URL, then try again."
									groups={modelGroups}
									loading={modelsLoading && catalogModels.length === 0}
									selectedId={defaultModel}
									onPick={(modelId) => void handlePickModel(modelId)}
								/>
							) : (
								<>
									<ModelPickList
										disabled={modelListBusy}
										emptyMessage="No models listed yet. Save credentials, then try again."
										flatModels={models}
										loading={modelsLoading && models.length === 0}
										selectedId={defaultModel}
										onPick={(modelId) => setValue("defaultModel", modelId, { shouldDirty: true })}
									/>
									<RhfTextField
										control={control}
										inputClassName={fieldInputClass}
										label="Custom model id"
										name="defaultModel"
										placeholder="optional — override with any model id"
									/>
								</>
							)}
							{error && modelDialogOpen ? <p className="text-body-sm text-error">{error}</p> : null}
						</Modal.Body>
						<Modal.Footer>
							<Button
								size="sm"
								type="button"
								variant="secondary"
								onPress={() => setModelDialogOpen(false)}
							>
								{isOpenCode ? "Close" : "Done"}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);

	return (
		<div
			className="space-y-5 border-t border-outline-variant px-4 pb-4 pt-4"
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<Form
				className="contents"
				onSubmit={handleSubmit(() => {
					void onSubmit();
				})}
			>
				{/* OpenCode: model picker first so it is visible without scrolling past env fields */}
				{isOpenCode ? modelPickerSummary : null}

				<div>
					<RhfTextField
						control={control}
						inputClassName={fieldInputClass}
						label="Display name"
						name="label"
						rules={{
							validate: (value) =>
								(typeof value === "string" && value.trim().length > 0) ||
								"Display name is required",
						}}
					/>
					<p className="mt-1.5 text-helper text-on-surface-variant">
						Optional label shown in the provider list.
					</p>
				</div>

				<div>
					<p className="text-body-sm text-on-surface">Accent color</p>
					<div className="mt-2 flex flex-wrap gap-2">
						{ACCENT_COLORS.map((color) => {
							const selected = accentColor === color.id;
							return (
								<button
									key={color.id}
									aria-label={color.id}
									className={[
										"flex size-7 items-center justify-center rounded-full transition",
										color.className,
										selected ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : "",
									].join(" ")}
									type="button"
									onClick={() => setValue("accentColor", color.id, { shouldDirty: true })}
								>
									{selected ? <span className="text-[10px] font-bold text-white">✓</span> : null}
								</button>
							);
						})}
					</div>
					<p className="mt-1.5 text-helper text-on-surface-variant">
						Used to distinguish this instance in picker rails and model lists.
					</p>
				</div>

				<div>
					<div className="flex items-center justify-between gap-2">
						<p className="text-body-sm text-on-surface">Environment variables</p>
						<Button size="sm" type="button" variant="ghost" onPress={() => append(newEnvRow())}>
							+ Add
						</Button>
					</div>
					<p className="mt-1 text-helper text-on-surface-variant">
						Add variables to pass API keys, base URLs, or other per-instance CLI settings. Sensitive
						values are stored separately and are not returned to the app after saving.
						{provider.envKeys.length > 0 ? ` Stored keys: ${provider.envKeys.join(", ")}.` : ""}
					</p>
					<div className="mt-2 space-y-2">
						{envFields.map((row, index) => (
							<div key={row.fieldId} className="flex gap-2">
								<RhfTextField
									aria-label="Env key"
									className="min-w-0 flex-1"
									control={control}
									inputClassName={fieldInputClass}
									name={`envRows.${index}.key`}
									placeholder="KEY"
								/>
								<RhfTextField
									aria-label="Env value"
									className="min-w-0 flex-1"
									control={control}
									inputClassName={fieldInputClass}
									name={`envRows.${index}.value`}
									placeholder={provider.envKeys.includes(row.key) ? "•••• (unchanged)" : "value"}
									type="password"
								/>
								<Button size="sm" type="button" variant="ghost" onPress={() => remove(index)}>
									Remove
								</Button>
							</div>
						))}
					</div>
				</div>

				{meta.defaultBinary || provider.binaryPath ? (
					<div>
						<RhfTextField
							control={control}
							inputClassName={fieldInputClass}
							label="Binary path"
							name="binaryPath"
							placeholder={meta.defaultBinary ?? "path"}
						/>
						<p className="mt-1.5 text-helper text-on-surface-variant">
							Path to the {meta.label} binary.
						</p>
					</div>
				) : null}

				{provider.kind === "opencode" ? (
					<div>
						<RhfTextField
							control={control}
							inputClassName={fieldInputClass}
							label="Server URL"
							name="serverUrl"
							placeholder="http://127.0.0.1:4096"
						/>
						<p className="mt-1.5 text-helper text-on-surface-variant">
							Optional. Local `opencode serve` is not used for vision (no OpenAI /v1). Prefer a Zen
							API key below.
						</p>
					</div>
				) : null}

				{provider.kind === "custom" ? (
					<div>
						<RhfTextField
							control={control}
							inputClassName={fieldInputClass}
							label="Base URL"
							name="baseUrl"
							placeholder="http://127.0.0.1:11434/v1"
							rules={{
								validate: (value) =>
									(typeof value === "string" && value.trim().length > 0) ||
									"Base URL is required for a custom provider",
							}}
						/>
						<p className="mt-1.5 text-helper text-on-surface-variant">
							OpenAI-compatible root ending in /v1 (required for validate + vision).
						</p>
					</div>
				) : null}

				{(provider.authMode === "api_key" || provider.authMode === "token") && (
					<RhfTextField
						control={control}
						inputClassName={fieldInputClass}
						label={
							<>
								{provider.authMode === "token" ? "Token" : "API key"}
								{provider.apiKeyLast4 ? ` (••••${provider.apiKeyLast4})` : ""}
							</>
						}
						name="apiKey"
						placeholder={
							provider.apiKeyLast4 ? "Leave blank to keep existing" : meta.keyPlaceholder
						}
						type="password"
					/>
				)}
				{provider.kind === "opencode" && provider.authMode === "cli" ? (
					<p className="text-helper text-on-surface-variant">
						Zen vision needs a Zen API key (Settings API key mode or OPENCODE_API_KEY). LiteLLM uses
						opencode.json plus CLI auth or LITELLM_API_KEY. Local serve is not OpenAI-compatible.
					</p>
				) : null}

				{!isOpenCode ? modelPickerSummary : null}

				{error && !modelDialogOpen ? <p className="text-body-sm text-error">{error}</p> : null}

				<div className="mt-2 grid grid-cols-3 items-center gap-3 border-t border-outline-variant pt-5">
					<div className="justify-self-start">
						<Button
							isDisabled={busy || saving || selectingModel}
							size="sm"
							type="button"
							variant="danger"
							onPress={() => void onDisconnect()}
						>
							Disconnect
						</Button>
					</div>
					<div className="justify-self-center">
						{!provider.isDefault ? (
							<Button
								isDisabled={busy || saving || selectingModel}
								size="sm"
								type="button"
								variant="secondary"
								onPress={() => void onSetDefault()}
							>
								Set as default
							</Button>
						) : (
							<span className="inline-flex h-8 items-center rounded-full bg-primary px-3 text-label-caps font-semibold tracking-wide text-on-primary">
								Default
							</span>
						)}
					</div>
					<div className="justify-self-end">
						<Button
							isDisabled={busy || saving || selectingModel || !label.trim()}
							size="sm"
							type="submit"
							variant="primary"
						>
							{saving ? (
								<>
									<Spinner aria-label="Saving" color="current" size="sm" />
									Saving…
								</>
							) : (
								"Save"
							)}
						</Button>
					</div>
				</div>
			</Form>

			{modelPickerDialog}
		</div>
	);
}
