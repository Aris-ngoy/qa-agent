import { getRunnerClient } from "@/app/runner-client";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { useMutation } from "@tanstack/react-query";
import type {
	CreateProviderRequest,
	ProbeProviderResponse,
	ProviderAuthMode,
	ProviderKind,
} from "@yoqa/runner-client";
import { useEffect, useMemo, useState } from "react";
import {
	ACTIVE_DRIVERS,
	ALL_DRIVER_CARDS,
	DriverGlyph,
	type DriverMeta,
	fieldInputClass,
	getDriverMeta,
} from "./driver-meta";
import { Stepper } from "./stepper";

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

function newEnvRow(key = "", value = ""): EnvRow {
	return { id: crypto.randomUUID(), key, value };
}

function stepIndex(step: WizardStep): number {
	return WIZARD_STEPS.findIndex((item) => item.id === step);
}

export function AddProviderModal({ open, onClose, onCreated }: AddProviderModalProps) {
	const [step, setStep] = useState<WizardStep>("driver");
	const [selectedKind, setSelectedKind] = useState<ProviderKind | null>(null);
	const [authMode, setAuthMode] = useState<ProviderAuthMode>("api_key");
	const [label, setLabel] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [binaryPath, setBinaryPath] = useState("");
	const [serverUrl, setServerUrl] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [defaultModel, setDefaultModel] = useState("");
	const [envRows, setEnvRows] = useState<EnvRow[]>([]);
	const [probe, setProbe] = useState<ProbeProviderResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	const meta = useMemo(() => (selectedKind ? getDriverMeta(selectedKind) : null), [selectedKind]);
	const currentStep = stepIndex(step);

	useEffect(() => {
		if (!open) {
			setStep("driver");
			setSelectedKind(null);
			setAuthMode("api_key");
			setLabel("");
			setApiKey("");
			setBinaryPath("");
			setServerUrl("");
			setBaseUrl("");
			setDefaultModel("");
			setEnvRows([]);
			setProbe(null);
			setError(null);
		}
	}, [open]);

	const probeMutation = useMutation({
		mutationFn: async (input: { kind: ProviderKind; binaryPath?: string | null }) => {
			const client = await getRunnerClient();
			return client.probeProvider(input);
		},
		onSuccess: (result) => {
			setProbe(result);
		},
	});

	const createMutation = useMutation({
		mutationFn: async (request: CreateProviderRequest) => {
			const client = await getRunnerClient();
			const created = await client.createProvider(request);
			try {
				await client.validateProvider(created.id);
			} catch {
				// Keep instance even if validation fails.
			}
			return created;
		},
		onSuccess: async () => {
			await onCreated();
			onClose();
		},
		onError: (err) => {
			setError(err instanceof Error ? err.message : "Failed to create provider");
		},
	});

	const selectDriver = (driver: DriverMeta) => {
		if (driver.comingSoon || !ACTIVE_DRIVERS.some((d) => d.kind === driver.kind)) return;
		const kind = driver.kind as ProviderKind;
		setSelectedKind(kind);
		setAuthMode(driver.authModes[0] ?? "api_key");
		setLabel(driver.label);
		setBinaryPath(driver.defaultBinary ?? "");
		setBaseUrl("");
		setDefaultModel(
			kind === "opencode" ? "deepseek-v4-flash-free" : kind === "grok" ? "grok-2-vision-1212" : "",
		);
		setEnvRows(driver.envHints.slice(0, 1).map((key) => newEnvRow(key)));
		setProbe(null);
		setError(null);
	};

	const goIdentity = () => {
		if (!selectedKind || !meta) return;
		setStep("identity");
		setError(null);
		if (meta.defaultBinary) {
			void probeMutation.mutateAsync({
				kind: selectedKind,
				binaryPath: binaryPath.trim() || null,
			});
		}
	};

	const goConfig = () => {
		if (!meta || !selectedKind) return;
		// Custom OpenAI-compatible hosts often need no API key (local Ollama / LM Studio).
		if (selectedKind !== "custom" && authMode !== "cli" && !apiKey.trim()) {
			const hasEnv = envRows.some((r) => r.key.trim() && r.value.trim());
			if (!hasEnv) {
				setError(
					authMode === "token" ? "Paste a token to continue" : "Paste an API key to continue",
				);
				return;
			}
		}
		setError(null);
		setStep("config");
	};

	const handleCreate = () => {
		if (!selectedKind || !meta) return;
		if (selectedKind === "custom" && !baseUrl.trim()) {
			setError("Base URL is required for a custom provider");
			return;
		}
		const env: Record<string, string> = {};
		for (const row of envRows) {
			if (row.key.trim() && row.value.trim()) {
				env[row.key.trim()] = row.value.trim();
			}
		}
		const request: CreateProviderRequest = {
			kind: selectedKind,
			authMode,
			label: label.trim() || meta.label,
			binaryPath: binaryPath.trim() || null,
			serverUrl: serverUrl.trim() || null,
			baseUrl: baseUrl.trim() || null,
			defaultModel: defaultModel.trim() || null,
			apiKey: apiKey.trim() || undefined,
			env: Object.keys(env).length > 0 ? env : undefined,
			setAsDefault: true,
		};
		createMutation.mutate(request);
	};

	const handleStepChange = (next: number) => {
		// Only allow navigating back to completed steps via the stepper.
		if (next >= currentStep) return;
		const target = WIZARD_STEPS[next];
		if (!target) return;
		setError(null);
		setStep(target.id);
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
									{ALL_DRIVER_CARDS.map((driver) => {
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
									<TextField className="gap-1.5" name="provider-label">
										<Label>Display name</Label>
										<Input
											className={fieldInputClass}
											value={label}
											onChange={(e) => setLabel(e.target.value)}
										/>
									</TextField>

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
													onClick={() => setAuthMode(mode)}
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
													void probeMutation.mutateAsync({
														kind: selectedKind,
														binaryPath: binaryPath.trim() || null,
													})
												}
											>
												Re-check
											</Button>
										</div>
									) : (
										<TextField className="gap-1.5" name="provider-secret">
											<Label>
												{authMode === "token"
													? "Token"
													: selectedKind === "custom"
														? "API key (optional)"
														: "API key"}
											</Label>
											<Input
												autoComplete="off"
												className={fieldInputClass}
												placeholder={meta.keyPlaceholder}
												type="password"
												value={apiKey}
												onChange={(e) => setApiKey(e.target.value)}
											/>
											{selectedKind === "custom" ? (
												<p className="text-helper text-on-surface-variant">
													Leave blank for local hosts that do not require auth.
												</p>
											) : null}
										</TextField>
									)}
								</div>
							) : null}

							{step === "config" && meta ? (
								<div className="space-y-4">
									{meta.defaultBinary ? (
										<TextField className="gap-1.5" name="provider-binary">
											<Label>Binary path</Label>
											<Input
												className={fieldInputClass}
												placeholder={meta.defaultBinary}
												value={binaryPath}
												onChange={(e) => setBinaryPath(e.target.value)}
											/>
										</TextField>
									) : null}

									{selectedKind === "opencode" ? (
										<TextField className="gap-1.5" name="provider-server">
											<Label>Server URL</Label>
											<Input
												className={fieldInputClass}
												placeholder="http://127.0.0.1:4096"
												value={serverUrl}
												onChange={(e) => setServerUrl(e.target.value)}
											/>
										</TextField>
									) : null}

									{selectedKind === "custom" ? (
										<TextField className="gap-1.5" name="provider-base">
											<Label>Base URL</Label>
											<Input
												className={fieldInputClass}
												placeholder="http://127.0.0.1:11434/v1"
												value={baseUrl}
												onChange={(e) => setBaseUrl(e.target.value)}
											/>
											<p className="text-helper text-on-surface-variant">
												OpenAI-compatible root ending in /v1 (required).
											</p>
										</TextField>
									) : null}

									<div>
										<div className="mb-2 flex items-center justify-between">
											<p className="text-body-sm text-on-surface">Environment variables</p>
											<Button
												size="sm"
												variant="ghost"
												onPress={() => setEnvRows((rows) => [...rows, newEnvRow()])}
											>
												+ Add
											</Button>
										</div>
										<div className="space-y-2">
											{envRows.map((row) => (
												<div key={row.id} className="flex gap-2">
													<Input
														aria-label="Env key"
														className={fieldInputClass}
														placeholder="KEY"
														value={row.key}
														onChange={(e) => {
															const value = e.target.value;
															setEnvRows((rows) =>
																rows.map((r) => (r.id === row.id ? { ...r, key: value } : r)),
															);
														}}
													/>
													<Input
														aria-label="Env value"
														className={fieldInputClass}
														placeholder="value"
														type="password"
														value={row.value}
														onChange={(e) => {
															const value = e.target.value;
															setEnvRows((rows) =>
																rows.map((r) => (r.id === row.id ? { ...r, value } : r)),
															);
														}}
													/>
												</div>
											))}
										</div>
									</div>

									<TextField className="gap-1.5" name="provider-model">
										<Label>Default model (optional)</Label>
										<Input
											className={fieldInputClass}
											placeholder={
												selectedKind === "opencode"
													? "deepseek-v4-flash-free"
													: selectedKind === "grok"
														? "grok-2-vision-1212"
														: selectedKind === "custom"
															? "required for vision runs"
															: "optional"
											}
											value={defaultModel}
											onChange={(e) => setDefaultModel(e.target.value)}
										/>
										{selectedKind === "opencode" ? (
											<p className="text-helper text-on-surface-variant">
												Defaults to deepseek-v4-flash-free (free + screenshots). Change later in
												provider details.
											</p>
										) : null}
									</TextField>
								</div>
							) : null}

							{error ? <p className="text-body-sm text-error">{error}</p> : null}
						</Modal.Body>
						<Modal.Footer>
							<Button variant="secondary" onPress={onClose}>
								Cancel
							</Button>
							{step === "driver" ? (
								<Button isDisabled={!selectedKind} variant="primary" onPress={goIdentity}>
									Next
								</Button>
							) : null}
							{step === "identity" ? (
								<>
									<Button variant="secondary" onPress={() => setStep("driver")}>
										Back
									</Button>
									<Button variant="primary" onPress={goConfig}>
										Next
									</Button>
								</>
							) : null}
							{step === "config" ? (
								<>
									<Button variant="secondary" onPress={() => setStep("identity")}>
										Back
									</Button>
									<Button
										isDisabled={createMutation.isPending}
										variant="primary"
										onPress={handleCreate}
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
