import { RhfTextField } from "@/app/forms";
import { Accordion, Button, Form, Modal, Spinner } from "@heroui/react";
import type { AiProvider, ProviderAccentColor, ProviderModel } from "@yoqa/runner-client";
import { type SVGProps, useEffect, useMemo, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { ACCENT_COLORS, fieldInputClass, getDriverMeta } from "./driver-meta";

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

/** Used when Zen catalog has not loaded yet so the user can still pick a free model. */
const OPENCODE_FALLBACK_FREE_MODELS: ProviderModel[] = [
	{ id: "mimo-v2.5-free", name: "MiMo V2.5 Free", tier: "free" },
	{ id: "deepseek-v4-flash-free", name: "DeepSeek V4 Flash Free", tier: "free" },
	{ id: "big-pickle", name: "Big Pickle", tier: "free" },
	{ id: "laguna-s-2.1-free", name: "Laguna S 2.1 Free", tier: "free" },
	{ id: "north-mini-code-free", name: "North Mini Code Free", tier: "free" },
	{ id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free", tier: "free" },
];

/** Hint: most Zen free models are text-only; mimo-v2.5-free accepts screenshots. */
const OPENCODE_NON_VISION_FREE_HINT =
	"Yoqa sends screenshots. Prefer mimo-v2.5-free — deepseek-v4-flash-free, big-pickle, and most other free models are text-only on Zen.";

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
	flatModels,
	selectedId,
	disabled,
	loading,
	emptyMessage,
	onPick,
}: {
	freeModels?: ProviderModel[];
	paidModels?: ProviderModel[];
	flatModels?: ProviderModel[];
	selectedId: string;
	disabled: boolean;
	loading?: boolean;
	emptyMessage: string;
	onPick: (modelId: string) => void;
}) {
	const renderModelRow = (model: ProviderModel) => {
		const selected = selectedId.trim() === model.id;
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

	const hasGrouped = (freeModels?.length ?? 0) > 0 || (paidModels?.length ?? 0) > 0;
	const hasFlat = (flatModels?.length ?? 0) > 0;
	const hasAny = hasGrouped || hasFlat;

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
				<Accordion defaultExpandedKeys={new Set(["free", "paid"])}>
					<Accordion.Item id="free">
						<Accordion.Heading>
							<Accordion.Trigger>Free</Accordion.Trigger>
						</Accordion.Heading>
						<Accordion.Panel className="p-0">
							<div className="divide-y divide-outline-variant">
								{freeModels?.map(renderModelRow)}
							</div>
						</Accordion.Panel>
					</Accordion.Item>
					<Accordion.Item id="paid">
						<Accordion.Heading>
							<Accordion.Trigger>Paid</Accordion.Trigger>
						</Accordion.Heading>
						<Accordion.Panel className="p-0">
							<div className="divide-y divide-outline-variant">
								{paidModels?.map(renderModelRow)}
							</div>
						</Accordion.Panel>
					</Accordion.Item>
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
	const meta = getDriverMeta(provider.kind);
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
				: "Showing free defaults (catalog unavailable)"
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
				selectedIsPaid ? (
					<p className="mt-1.5 text-helper text-on-surface-variant">
						Paid models need Zen billing at opencode.ai. Prefer a Free model if you have no payment
						method. {OPENCODE_NON_VISION_FREE_HINT}
					</p>
				) : (
					<p className="mt-1.5 text-helper text-on-surface-variant">
						{OPENCODE_NON_VISION_FREE_HINT}
					</p>
				)
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
									? "Selection saves immediately for OpenCode."
									: "Pick a catalog model or enter a custom id, then save the provider."}
							</p>
						</Modal.Header>
						<Modal.Body className="gap-4">
							{isOpenCode ? (
								<ModelPickList
									disabled={modelListBusy}
									emptyMessage="No models listed yet. Add an API key or server URL, then try again."
									freeModels={freeModels}
									loading={modelsLoading && catalogModels.length === 0}
									paidModels={paidModels}
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
						Vision needs a Zen API key (Settings API key mode or OPENCODE_API_KEY). Local serve is
						not OpenAI-compatible.
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
