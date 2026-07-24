import { RhfTextField } from "@/app/forms";
import { Button, Form } from "@heroui/react";
import type { AiProvider, ProviderAccentColor, ProviderModel } from "@yoqa/runner-client";
import { useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ACCENT_COLORS, fieldInputClass, getDriverMeta } from "./driver-meta";

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

/** Used when Zen catalog has not loaded yet so the user can still pick a free model. */
const OPENCODE_FALLBACK_FREE_MODELS: ProviderModel[] = [
	{ id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", tier: "free" },
	{ id: "big-pickle", name: "Big Pickle", tier: "free" },
	{ id: "mimo-v2.5-free", name: "MiMo V2.5 Free", tier: "free" },
	{ id: "laguna-s-2.1-free", name: "Laguna S 2.1 Free", tier: "free" },
	{ id: "north-mini-code-free", name: "North Mini Code Free", tier: "free" },
	{ id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", tier: "free" },
];

/** Free models known to fail Zen vision/screenshot requests with opaque HTTP 500s. */
const OPENCODE_NON_VISION_FREE_HINT =
	"YoQA sends screenshots. Prefer deepseek-v4-flash-free — several free models (north-mini-code-free, big-pickle, …) return opaque 500s on image inputs.";

function isPaidModelSelected(models: ProviderModel[], defaultModel: string): boolean {
	const id = defaultModel.trim();
	if (!id) return false;
	const match = models.find((model) => model.id === id);
	if (match?.tier === "paid") return true;
	if (match?.tier === "free") return false;
	const lower = id.toLowerCase();
	return !(lower === "big-pickle" || lower.endsWith("-free"));
}

function ModelPickList({
	freeModels,
	paidModels,
	selectedId,
	disabled,
	onPick,
}: {
	freeModels: ProviderModel[];
	paidModels: ProviderModel[];
	selectedId: string;
	disabled: boolean;
	onPick: (modelId: string) => void;
}) {
	const renderGroup = (title: string, items: ProviderModel[]) => {
		if (items.length === 0) return null;
		return (
			<div>
				<p className="border-b border-outline-variant bg-surface-container-low px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
					{title}
				</p>
				<ul className="divide-y divide-outline-variant">
					{items.map((model) => {
						const selected = selectedId === model.id;
						return (
							<li key={model.id}>
								<button
									className={[
										"flex w-full items-center justify-between px-3 py-2.5 text-left text-body-sm transition-colors",
										selected ? "bg-primary/15 font-semibold text-on-surface" : "text-on-surface",
										disabled ? "cursor-not-allowed opacity-60" : "hover:bg-surface-container/60",
									].join(" ")}
									disabled={disabled}
									type="button"
									onClick={(event) => {
										event.stopPropagation();
										if (disabled) return;
										onPick(model.id);
									}}
								>
									<span className="min-w-0 truncate">{model.name}</span>
									<span className="ml-2 shrink-0 font-mono text-helper text-on-surface-variant">
										{model.id}
									</span>
									{selected ? (
										<span className="ml-2 shrink-0 text-helper text-primary">Selected</span>
									) : null}
								</button>
							</li>
						);
					})}
				</ul>
			</div>
		);
	};

	return (
		<div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-outline-variant">
			{renderGroup("Free", freeModels)}
			{renderGroup("Paid", paidModels)}
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
	const meta = getDriverMeta(provider.kind);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [selectingModel, setSelectingModel] = useState(false);

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
		if (isOpenCode && !modelsLoading) return OPENCODE_FALLBACK_FREE_MODELS;
		return models;
	}, [isOpenCode, models, modelsLoading]);

	const freeModels = useMemo(
		() => catalogModels.filter((model) => model.tier === "free"),
		[catalogModels],
	);
	const paidModels = useMemo(
		() => catalogModels.filter((model) => model.tier !== "free"),
		[catalogModels],
	);
	const selectedIsPaid = isOpenCode && isPaidModelSelected(catalogModels, defaultModel);

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
		setSelectingModel(true);
		setError(null);
		try {
			await persist({ defaultModel: modelId });
			setValue("apiKey", "");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save model");
		} finally {
			setSelectingModel(false);
		}
	};

	const modelListBusy = busy || saving || selectingModel;

	const openCodeModelSection = (
		<div
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<div className="flex items-baseline justify-between gap-2">
				<p className="text-body-sm font-semibold text-on-surface">Default model</p>
				<p className="text-helper text-on-surface-variant">
					{modelsLoading
						? "Loading catalog…"
						: models.length > 0
							? modelsMessage
							: "Showing free defaults (catalog unavailable)"}
				</p>
			</div>
			<p className="mt-1 truncate text-body-sm text-on-surface">
				{defaultModel ? (
					<>
						Current: <span className="font-semibold">{defaultModel}</span>
						{selectingModel ? " · Saving…" : ""}
					</>
				) : (
					<span className="text-on-surface-variant">No model selected</span>
				)}
			</p>
			{catalogModels.length === 0 ? (
				<p className="mt-2 text-body-sm text-on-surface-variant">
					{modelsLoading
						? "Fetching models…"
						: "No models listed yet. Add an API key or server URL, then expand again."}
				</p>
			) : (
				<ModelPickList
					disabled={modelListBusy}
					freeModels={freeModels}
					paidModels={paidModels}
					selectedId={defaultModel}
					onPick={(modelId) => void handlePickModel(modelId)}
				/>
			)}
			{selectedIsPaid ? (
				<p className="mt-1.5 text-helper text-on-surface-variant">
					Paid models need Zen billing at opencode.ai. Prefer a Free model if you have no payment
					method. {OPENCODE_NON_VISION_FREE_HINT}
				</p>
			) : (
				<p className="mt-1.5 text-helper text-on-surface-variant">
					{OPENCODE_NON_VISION_FREE_HINT}
				</p>
			)}
		</div>
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
				{isOpenCode ? openCodeModelSection : null}

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
							Leave blank to let YoQA use the CLI / hosted OpenCode catalogs when needed.
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

				{!isOpenCode ? (
					<>
						<RhfTextField
							control={control}
							inputClassName={fieldInputClass}
							label="Default model"
							name="defaultModel"
							placeholder="optional"
						/>

						<div>
							<div className="flex items-baseline justify-between gap-2">
								<p className="text-body-sm font-semibold text-on-surface">Models</p>
								<p className="text-helper text-on-surface-variant">
									{modelsLoading ? "Loading…" : modelsMessage}
								</p>
							</div>
							<div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-outline-variant">
								{models.length === 0 ? (
									<p className="px-3 py-4 text-body-sm text-on-surface-variant">
										{modelsLoading ? "Fetching models…" : "No models listed yet."}
									</p>
								) : (
									<ul className="divide-y divide-outline-variant">
										{models.slice(0, 40).map((model) => (
											<li key={model.id}>
												<button
													className={[
														"flex w-full items-center justify-between px-3 py-2 text-left text-body-sm transition-colors hover:bg-surface-container/60",
														defaultModel === model.id ? "bg-surface-container font-semibold" : "",
													].join(" ")}
													type="button"
													onClick={() => setValue("defaultModel", model.id, { shouldDirty: true })}
												>
													<span className="truncate text-on-surface">{model.name}</span>
													{defaultModel === model.id ? (
														<span className="text-helper text-primary">Default</span>
													) : null}
												</button>
											</li>
										))}
									</ul>
								)}
							</div>
						</div>
					</>
				) : null}

				{error ? <p className="text-body-sm text-error">{error}</p> : null}

				<div className="flex flex-wrap items-center justify-between gap-2">
					<div className="flex flex-wrap gap-2">
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
							<span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-on-primary">
								Default
							</span>
						)}
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
					<Button
						isDisabled={busy || saving || selectingModel || !label.trim()}
						size="sm"
						type="submit"
						variant="primary"
					>
						{saving ? "Saving…" : "Save"}
					</Button>
				</div>
			</Form>
		</div>
	);
}
