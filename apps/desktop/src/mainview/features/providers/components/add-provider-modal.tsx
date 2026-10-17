import { RhfTextField } from "@/app/forms";
import { DriverGlyph } from "@/features/providers/components/driver-glyph";
import { Stepper } from "@/features/providers/components/stepper";
import {
	useActiveDrivers,
	useDriverCards,
	useDriverMeta,
} from "@/features/providers/hooks/use-driver-meta";
import {
	useCreateProvider,
	useProbeProvider,
} from "@/features/providers/hooks/usequery/use-providers";
import { type DriverMeta, fieldInputClass } from "@/features/providers/utils/driver-meta";
import { Button, Modal } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type {
	CreateProviderRequest,
	ProbeProviderResponse,
	ProviderAuthMode,
	ProviderKind,
} from "@yoqa/runner-client";
import { useEffect } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

const WIZARD_STEPS = [
	{ id: "driver", title: "Driver", description: "Choose a provider" },
	{ id: "identity", title: "Identity", description: "Name & auth" },
	{ id: "config", title: "Config", description: "Paths & env" },
] as const;

type WizardStep = (typeof WIZARD_STEPS)[number]["id"];

type AddProviderModalProps = {
	open: boolean;
	onClose: () => void;
	onCreated: () => Promise<void>;
};

type EnvRow = { id: string; key: string; value: string };

type ProviderFormValues = {
	label: string;
	apiKey: string;
	binaryPath: string;
	serverUrl: string;
	baseUrl: string;
	defaultModel: string;
	envRows: EnvRow[];
};

function newEnvRow(key = "", value = ""): EnvRow {
	return { id: crypto.randomUUID(), key, value };
}

function stepIndex(step: WizardStep): number {
	return WIZARD_STEPS.findIndex((item) => item.id === step);
}

type WizardState = {
	step: WizardStep;
	selectedKind: ProviderKind | null;
	authMode: ProviderAuthMode;
	probe: ProbeProviderResponse | null;
	error: string | null;
};

function initialWizard(): WizardState {
	return { step: "driver", selectedKind: null, authMode: "api_key", probe: null, error: null };
}

const emptyForm: ProviderFormValues = {
	label: "",
	apiKey: "",
	binaryPath: "",
	serverUrl: "",
	baseUrl: "",
	defaultModel: "",
	envRows: [],
};

export function AddProviderModal({ open, onClose, onCreated }: AddProviderModalProps) {
	const wizard$ = useObservable(initialWizard());
	const step = useValue(wizard$.step);
	const selectedKind = useValue(wizard$.selectedKind);
	const authMode = useValue(wizard$.authMode);
	const probe = useValue(wizard$.probe);
	const error = useValue(wizard$.error);

	const { control, handleSubmit, reset, getValues, trigger } = useForm<ProviderFormValues>({
		defaultValues: emptyForm,
		mode: "onSubmit",
	});

	const { fields: envFields, append } = useFieldArray({
		control,
		name: "envRows",
		keyName: "fieldId",
	});

	const binaryPath = useWatch({ control, name: "binaryPath" });
	const apiKey = useWatch({ control, name: "apiKey" });
	const envRows = useWatch({ control, name: "envRows" }) ?? [];

	const activeDrivers = useActiveDrivers(open);
	const driverCards = useDriverCards(open);
	const meta = useDriverMeta(selectedKind ?? "anthropic", open && selectedKind != null);
	const currentStep = stepIndex(step);

	useEffect(() => {
		if (!open) {
			wizard$.set(initialWizard());
			reset(emptyForm);
		}
	}, [open, reset, wizard$]);

	const probeMutation = useProbeProvider();
	const runProbe = (input: { kind: ProviderKind; binaryPath?: string | null }) =>
		probeMutation.mutateAsync(input).then((result) => {
			wizard$.probe.set(result);
			return result;
		});

	const createMutation = useCreateProvider({
		onSuccess: async () => {
			await onCreated();
			onClose();
		},
		onError: (message) => wizard$.error.set(message),
	});

	const selectDriver = (driver: DriverMeta) => {
		if (driver.comingSoon || !activeDrivers.some((d) => d.kind === driver.kind)) return;
		const kind = driver.kind as ProviderKind;
		wizard$.selectedKind.set(kind);
		wizard$.authMode.set(driver.authModes[0] ?? "api_key");
		reset({
			label: driver.label,
			apiKey: "",
			binaryPath: driver.defaultBinary ?? "",
			serverUrl: "",
			baseUrl: "",
			defaultModel:
				kind === "opencode" ? "mimo-v2.5-free" : kind === "grok" ? "grok-2-vision-1212" : "",
			envRows: driver.envHints.slice(0, 1).map((key) => newEnvRow(key)),
		});
		wizard$.probe.set(null);
		wizard$.error.set(null);
	};

	const goIdentity = () => {
		if (!selectedKind || !meta) return;
		wizard$.step.set("identity");
		wizard$.error.set(null);
		if (meta.defaultBinary) {
			void runProbe({
				kind: selectedKind,
				binaryPath: binaryPath.trim() || null,
			});
		}
	};

	const goConfig = async () => {
		if (!meta || !selectedKind) return;
		// Custom OpenAI-compatible hosts often need no API key (local Ollama / LM Studio).
		// OpenCode vision uses hosted Zen — require a key (local serve has no OpenAI /v1).
		if (selectedKind === "opencode") {
			const hasEnv = envRows.some((r) => r.key.trim() && r.value.trim());
			if (!apiKey.trim() && !hasEnv) {
				wizard$.error.set("Paste a Zen API key from opencode.ai to continue (required for vision)");
				return;
			}
		} else if (selectedKind !== "custom" && authMode !== "cli" && !apiKey.trim()) {
			const hasEnv = envRows.some((r) => r.key.trim() && r.value.trim());
			if (!hasEnv) {
				wizard$.error.set(
					authMode === "token" ? "Paste a token to continue" : "Paste an API key to continue",
				);
				return;
			}
		}
		wizard$.error.set(null);
		wizard$.step.set("config");
	};

	const onCreate = (values: ProviderFormValues) => {
		if (!selectedKind || !meta) return;
		if (selectedKind === "custom" && !values.baseUrl.trim()) {
			wizard$.error.set("Base URL is required for a custom provider");
			return;
		}
		const env: Record<string, string> = {};
		for (const row of values.envRows) {
			if (row.key.trim() && row.value.trim()) {
				env[row.key.trim()] = row.value.trim();
			}
		}
		const request: CreateProviderRequest = {
			kind: selectedKind,
			authMode,
			label: values.label.trim() || meta.label,
			binaryPath: values.binaryPath.trim() || null,
			serverUrl: values.serverUrl.trim() || null,
			baseUrl: values.baseUrl.trim() || null,
			defaultModel: values.defaultModel.trim() || null,
			apiKey: values.apiKey.trim() || undefined,
			env: Object.keys(env).length > 0 ? env : undefined,
			setAsDefault: true,
		};
		createMutation.mutate(request);
	};

	const handleCreate = () => {
		void handleSubmit(onCreate)();
	};

	const handleStepChange = (next: number) => {
		// Only allow navigating back to completed steps via the stepper.
		if (next >= currentStep) return;
		const target = WIZARD_STEPS[next];
		if (!target) return;
		wizard$.error.set(null);
		wizard$.step.set(target.id);
	};

	return (
		<Modal>
			<Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onClose()} variant="opaque">
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="max-h-[min(36rem,90vh)] overflow-hidden sm:max-w-2xl">
						<Modal.CloseTrigger />
						<Modal.Header className="flex flex-col gap-1">
							<Modal.Heading>Add provider instance</Modal.Heading>
							<p className="text-body-sm text-on-surface-variant">
								Configure an additional provider instance — for example, a second Codex install
								pointed at a different workspace.
							</p>
						</Modal.Header>
						<Modal.Body className="gap-5">
							<Stepper
								className="w-full"
								currentStep={currentStep}
								orientation="horizontal"
								size="sm"
								onStepChange={handleStepChange}
							>
								{WIZARD_STEPS.map((item) => (
									<Stepper.Step key={item.id}>
										<Stepper.StepButton>
											<span className="flex w-full items-center">
												<Stepper.Indicator />
												<Stepper.Separator />
											</span>
											<Stepper.Content>
												<Stepper.Title>{item.title}</Stepper.Title>
												<Stepper.Description>{item.description}</Stepper.Description>
											</Stepper.Content>
										</Stepper.StepButton>
									</Stepper.Step>
								))}
							</Stepper>

							{step === "driver" ? (
								<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
									{driverCards.map((driver) => {
										const selected = selectedKind === driver.kind;
										const disabled = Boolean(driver.comingSoon);
										return (
											<button
												key={driver.kind}
												className={[
													"relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition",
													disabled
														? "cursor-not-allowed border-outline-variant/50 opacity-50"
														: selected
															? "border-primary bg-primary/5"
															: "border-outline-variant hover:border-primary/50",
												].join(" ")}
												disabled={disabled}
												type="button"
												onClick={() => selectDriver(driver)}
											>
												{driver.comingSoon || driver.earlyAccess ? (
													<span className="absolute top-2 right-2 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-400">
														{driver.comingSoon ? "Coming Soon" : "Early Access"}
													</span>
												) : null}
												<DriverGlyph kind={driver.kind} />
												<span className="text-body-sm font-semibold text-on-surface">
													{driver.label}
												</span>
											</button>
										);
									})}
								</div>
							) : null}

							{step === "identity" && meta && selectedKind ? (
								<div className="space-y-4">
									<RhfTextField
										control={control}
										inputClassName={fieldInputClass}
										label="Display name"
										name="label"
									/>

									<div>
										<p className="mb-2 text-body-sm text-on-surface">Auth method</p>
										<div className="flex flex-wrap gap-2">
											{meta.authModes.map((mode) => (
												<button
													key={mode}
													className={[
														"rounded-lg border px-3 py-2 text-body-sm font-medium transition",
														authMode === mode
															? "border-primary bg-primary/10 text-primary"
															: "border-outline-variant text-on-surface-variant",
													].join(" ")}
													type="button"
													onClick={() => wizard$.authMode.set(mode)}
												>
													{mode === "api_key"
														? "API key"
														: mode === "token"
															? "Token"
															: "CLI login"}
												</button>
											))}
										</div>
									</div>

									{authMode === "cli" ? (
										<div className="rounded-lg border border-outline-variant bg-surface-container/40 px-3 py-3">
											<p className="text-body-sm text-on-surface">
												{probeMutation.isPending
													? "Checking CLI…"
													: probe?.detail || meta.loginInstructions}
											</p>
											{meta.loginInstructions ? (
												<p className="mt-2 text-helper text-on-surface-variant">
													{meta.loginInstructions}
												</p>
											) : null}
											<Button
												className="mt-3"
												isDisabled={probeMutation.isPending}
												size="sm"
												variant="secondary"
												onPress={() =>
													void runProbe({
														kind: selectedKind,
														binaryPath: getValues("binaryPath").trim() || null,
													})
												}
											>
												Re-check
											</Button>
										</div>
									) : (
										<div>
											<RhfTextField
												control={control}
												inputClassName={fieldInputClass}
												label={
													authMode === "token"
														? "Token"
														: selectedKind === "custom"
															? "API key (optional)"
															: "API key"
												}
												name="apiKey"
												placeholder={meta.keyPlaceholder}
												type="password"
											/>
											{selectedKind === "custom" ? (
												<p className="mt-1.5 text-helper text-on-surface-variant">
													Leave blank for local hosts that do not require auth.
												</p>
											) : null}
										</div>
									)}
								</div>
							) : null}

							{step === "config" && meta ? (
								<div className="space-y-4">
									{meta.defaultBinary ? (
										<RhfTextField
											control={control}
											inputClassName={fieldInputClass}
											label="Binary path"
											name="binaryPath"
											placeholder={meta.defaultBinary}
										/>
									) : null}

									{selectedKind === "opencode" ? (
										<RhfTextField
											control={control}
											inputClassName={fieldInputClass}
											label="Server URL"
											name="serverUrl"
											placeholder="http://127.0.0.1:4096"
										/>
									) : null}

									{selectedKind === "custom" ? (
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
												OpenAI-compatible root ending in /v1 (required).
											</p>
										</div>
									) : null}

									<div>
										<div className="mb-2 flex items-center justify-between">
											<p className="text-body-sm text-on-surface">Environment variables</p>
											<Button
												size="sm"
												type="button"
												variant="ghost"
												onPress={() => append(newEnvRow())}
											>
												+ Add
											</Button>
										</div>
										<div className="space-y-2">
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
														placeholder="value"
														type="password"
													/>
												</div>
											))}
										</div>
									</div>

									<div>
										<RhfTextField
											control={control}
											inputClassName={fieldInputClass}
											label="Default model (optional)"
											name="defaultModel"
											placeholder={
												selectedKind === "opencode"
													? "mimo-v2.5-free"
													: selectedKind === "grok"
														? "grok-2-vision-1212"
														: selectedKind === "custom"
															? "required for vision runs"
															: "optional"
											}
										/>
										{selectedKind === "opencode" ? (
											<p className="mt-1.5 text-helper text-on-surface-variant">
												Defaults to mimo-v2.5-free (free + screenshots). Change later in provider
												details.
											</p>
										) : null}
									</div>
								</div>
							) : null}

							{error ? <p className="text-body-sm text-error">{error}</p> : null}
						</Modal.Body>
						<Modal.Footer>
							<Button type="button" variant="secondary" onPress={onClose}>
								Cancel
							</Button>
							{step === "driver" ? (
								<Button
									isDisabled={!selectedKind}
									type="button"
									variant="primary"
									onPress={goIdentity}
								>
									Next
								</Button>
							) : null}
							{step === "identity" ? (
								<>
									<Button
										type="button"
										variant="secondary"
										onPress={() => wizard$.step.set("driver")}
									>
										Back
									</Button>
									<Button
										type="button"
										variant="primary"
										onPress={() => {
											void goConfig();
										}}
									>
										Next
									</Button>
								</>
							) : null}
							{step === "config" ? (
								<>
									<Button
										type="button"
										variant="secondary"
										onPress={() => wizard$.step.set("identity")}
									>
										Back
									</Button>
									<Button
										isDisabled={createMutation.isPending}
										type="button"
										variant="primary"
										onPress={() => {
											if (selectedKind === "custom") {
												void trigger("baseUrl").then((ok) => {
													if (ok) handleCreate();
												});
												return;
											}
											handleCreate();
										}}
									>
										{createMutation.isPending ? "Saving…" : "Add provider"}
									</Button>
								</>
							) : null}
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
