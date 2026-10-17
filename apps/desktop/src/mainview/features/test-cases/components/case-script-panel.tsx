import { downloadTextFile } from "@/app/download";
import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { GripIcon, TrashIcon } from "@/features/test-cases/components/case-icons";
import { configCardClass, fieldAreaClass } from "@/features/test-cases/utils/case-styles";
import {
	formatScriptSavedAt,
	scriptActionSummary,
} from "@/features/test-cases/utils/script-summary";
import { AlertDialog, Button, Tabs } from "@heroui/react";
import { batch } from "@legendapp/state";
import { useObservable, useValue } from "@legendapp/state/react";
import {
	CASE_SCRIPT_FILE_ACCEPT,
	CASE_SCRIPT_FILE_EXTENSION,
	type CaseScript,
	type CaseScriptAction,
	formatCaseScriptFile,
	formatCaseScriptFileErrors,
	formatCaseScriptShell,
	parseCaseScriptFile,
	suggestedScriptBasename,
	toCaseScriptFileText,
} from "@yoqa/runner-client";
import { useEffect, useRef } from "react";

type ScriptViewMode = "steps" | "yaml" | "shell";

export function CaseScriptPanel({
	script,
	scriptSavedAt,
	caseNumber,
	caseName,
	busy,
	onSaveScript,
	onDeleteScript,
}: {
	script: CaseScript | null;
	scriptSavedAt: number | null;
	caseNumber: number;
	caseName: string;
	busy: boolean;
	onSaveScript: (next: CaseScript) => Promise<void>;
	onDeleteScript: () => Promise<void>;
}) {
	const panel$ = useObservable({
		view: "steps" as ScriptViewMode,
		editing: false,
		/** The YAML editor's text while editing. */
		draft: "",
		editError: null as string | null,
		deleteOpen: false,
		actionError: null as string | null,
		/** The steps as shown, reordered live while a drag is in flight. */
		steps: [] as CaseScriptAction[],
		draggingIndex: null as number | null,
	});
	const view = useValue(panel$.view);
	const editing = useValue(panel$.editing);
	const draft = useValue(panel$.draft);
	const editError = useValue(panel$.editError);
	const deleteOpen = useValue(panel$.deleteOpen);
	const actionError = useValue(panel$.actionError);
	const steps = useValue(panel$.steps);
	const draggingIndex = useValue(panel$.draggingIndex);
	const importInputRef = useRef<HTMLInputElement | null>(null);

	const exportMeta = { caseNumber, caseName };

	useEffect(() => {
		if (!editing && script) {
			batch(() => {
				panel$.draft.set(formatCaseScriptFile(script).trimEnd());
				panel$.editError.set(null);
			});
		}
	}, [script, editing, panel$]);

	useEffect(() => {
		if (!script || draggingIndex !== null) return;
		panel$.steps.set(script.actions.map((action) => ({ ...action })));
	}, [script, draggingIndex, panel$]);

	const reduceMotion = useReducedMotion();

	/** Replace the Case Script from a Case Script file (YAML, legacy JSON, or shell). */
	const importFile = async (file: File) => {
		panel$.actionError.set(null);
		panel$.editError.set(null);
		const converted = toCaseScriptFileText(await file.text());
		const parsed = converted.text
			? parseCaseScriptFile(converted.text, { savedAt: Date.now() })
			: null;
		if (!parsed?.ok) {
			panel$.actionError.set(
				`Can’t import ${file.name}:\n${formatCaseScriptFileErrors(parsed ? parsed.errors : converted.errors)}`,
			);
			return;
		}
		try {
			await onSaveScript(parsed.script);
			panel$.editing.set(false);
			if (converted.warnings.length > 0) {
				panel$.actionError.set(
					`Imported ${file.name} with warnings:\n${converted.warnings.join("\n")}`,
				);
			}
		} catch (error) {
			panel$.actionError.set(error instanceof Error ? error.message : "Failed to import script");
		}
	};

	const importInput = (
		<input
			accept={CASE_SCRIPT_FILE_ACCEPT}
			className="hidden"
			onChange={(event) => {
				const file = event.target.files?.[0];
				event.target.value = "";
				if (file) void importFile(file);
			}}
			ref={importInputRef}
			type="file"
		/>
	);

	if (!script) {
		return (
			<div className={`${configCardClass} max-w-2xl`}>
				<h2 className="mb-1.5 text-headline-md text-on-surface">Saved script</h2>
				<p className="mb-4 text-body-md text-on-surface-variant">
					No script yet. After a successful AI agent run, Yoqa saves the tap, type, wait, and alert
					actions here so you can replay the case without calling the model. You can also import a
					Case Script file ({CASE_SCRIPT_FILE_EXTENSION}).
				</p>
				{importInput}
				<Button
					className="rounded-lg"
					isDisabled={busy}
					onPress={() => importInputRef.current?.click()}
					variant="secondary"
				>
					Import…
				</Button>
				{actionError ? (
					<p className="mt-3 whitespace-pre-line text-body-sm text-error" role="alert">
						{actionError}
					</p>
				) : null}
			</div>
		);
	}

	const savedLabel = formatScriptSavedAt(scriptSavedAt ?? script.savedAt);
	const baseName = suggestedScriptBasename(exportMeta);

	const persistSteps = async (next: CaseScriptAction[]) => {
		panel$.actionError.set(null);
		if (next.length === 0) {
			await onDeleteScript();
			return;
		}
		await onSaveScript({
			version: 1,
			sourceRunId: script.sourceRunId,
			savedAt: Date.now(),
			actions: next,
		});
	};

	const startEdit = () => {
		panel$.draft.set(formatCaseScriptFile(script).trimEnd());
		panel$.editError.set(null);
		panel$.actionError.set(null);
		panel$.editing.set(true);
		panel$.view.set("yaml");
	};

	const cancelEdit = () => {
		panel$.editing.set(false);
		panel$.editError.set(null);
		panel$.draft.set(formatCaseScriptFile(script).trimEnd());
	};

	const saveEdit = async () => {
		panel$.editError.set(null);
		panel$.actionError.set(null);
		const parsed = parseCaseScriptFile(draft, { savedAt: Date.now() });
		if (!parsed.ok) {
			panel$.editError.set(formatCaseScriptFileErrors(parsed.errors));
			return;
		}
		try {
			await onSaveScript(parsed.script);
			panel$.editing.set(false);
		} catch (error) {
			panel$.actionError.set(error instanceof Error ? error.message : "Failed to save script");
		}
	};

	const exportYaml = () => {
		downloadTextFile(
			`${baseName}${CASE_SCRIPT_FILE_EXTENSION}`,
			formatCaseScriptFile(script, { name: caseName }),
			"application/yaml",
		);
	};

	const exportShell = () => {
		downloadTextFile(
			`${baseName}.sh`,
			formatCaseScriptShell(script, exportMeta),
			"text/x-shellscript",
		);
	};

	const deleteStep = async (index: number) => {
		const next = steps.filter((_, i) => i !== index);
		panel$.steps.set(next);
		try {
			await persistSteps(next);
		} catch (error) {
			panel$.steps.set(script.actions.map((action) => ({ ...action })));
			panel$.actionError.set(error instanceof Error ? error.message : "Failed to delete step");
		}
	};

	const finishReorder = async () => {
		panel$.draggingIndex.set(null);
		const next = panel$.steps.peek();
		const same =
			next.length === script.actions.length &&
			next.every((action, index) => {
				const original = script.actions[index];
				return original != null && JSON.stringify(action) === JSON.stringify(original);
			});
		if (same) return;
		try {
			await persistSteps(next);
		} catch (error) {
			panel$.steps.set(script.actions.map((action) => ({ ...action })));
			panel$.actionError.set(error instanceof Error ? error.message : "Failed to reorder steps");
		}
	};

	const viewTabs: { id: ScriptViewMode; label: string }[] = [
		{ id: "steps", label: "Steps" },
		{ id: "yaml", label: "YAML" },
		{ id: "shell", label: "Shell" },
	];

	return (
		<div className="flex w-full max-w-2xl flex-col gap-5">
			<section className={`${configCardClass} motion-fade-up`}>
				<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 className="mb-1.5 text-headline-md text-on-surface">Saved script</h2>
						<p className="text-body-md text-on-surface-variant">
							Replayable actions from a successful agent run. Used by default when you press Run.
						</p>
					</div>
					<span className="motion-scale-in rounded-full bg-secondary-container/70 px-3 py-1 text-helper font-semibold text-on-secondary-container">
						{steps.length} step{steps.length === 1 ? "" : "s"}
					</span>
				</div>

				<dl className="mb-5 grid gap-2 text-body-sm text-on-surface-variant sm:grid-cols-2">
					<div>
						<dt className="font-medium text-on-surface">Saved</dt>
						<dd>{savedLabel}</dd>
					</div>
					{script.sourceRunId ? (
						<div>
							<dt className="font-medium text-on-surface">Source run</dt>
							<dd className="truncate font-mono text-helper">{script.sourceRunId}</dd>
						</div>
					) : null}
				</dl>

				<Tabs
					className="w-full"
					onSelectionChange={(key) => {
						const next = String(key) as ScriptViewMode;
						if (editing && next !== "yaml") return;
						panel$.view.set(next);
					}}
					selectedKey={view}
				>
					<Tabs.ListContainer className="mb-4">
						<Tabs.List
							aria-label="Script view"
							className="relative w-fit max-w-full gap-1 rounded-xl bg-surface-container p-1"
						>
							{viewTabs.map((tab) => (
								<Tabs.Tab
									className="relative z-[1] h-auto min-h-9 rounded-lg px-3.5 py-1.5 text-body-sm font-medium text-on-surface-variant transition-[color,opacity] duration-[var(--motion-fast)] data-[selected=true]:font-semibold data-[selected=true]:!text-on-surface"
									id={tab.id}
									isDisabled={editing && tab.id !== "yaml"}
									key={tab.id}
								>
									{tab.label}
									{/* Keep indicator behind label; HeroUI defaults to white segment text */}
									<Tabs.Indicator className="-z-10 rounded-lg bg-surface-container-lowest shadow-card" />
								</Tabs.Tab>
							))}
						</Tabs.List>
					</Tabs.ListContainer>

					<div className="mb-5 flex flex-wrap items-center gap-2">
						{editing ? (
							<>
								<Button
									className="rounded-lg"
									isDisabled={busy}
									onPress={() => void saveEdit()}
									variant="primary"
								>
									{busy ? "Saving…" : "Save script"}
								</Button>
								<Button
									className="rounded-lg"
									isDisabled={busy}
									onPress={cancelEdit}
									variant="secondary"
								>
									Cancel
								</Button>
							</>
						) : (
							<>
								<Button
									className="rounded-lg"
									isDisabled={busy}
									onPress={startEdit}
									variant="secondary"
								>
									Edit YAML
								</Button>
								<Button
									className="rounded-lg"
									isDisabled={busy}
									onPress={exportYaml}
									variant="secondary"
								>
									Export YAML
								</Button>
								{importInput}
								<Button
									className="rounded-lg"
									isDisabled={busy}
									onPress={() => importInputRef.current?.click()}
									variant="secondary"
								>
									Import…
								</Button>
								<Button
									className="rounded-lg"
									isDisabled={busy}
									onPress={exportShell}
									variant="secondary"
								>
									Export shell
								</Button>
								<Button
									className="rounded-lg text-error data-[hovered=true]:bg-error-container/40"
									isDisabled={busy}
									onPress={() => panel$.deleteOpen.set(true)}
									variant="ghost"
								>
									Delete all
								</Button>
							</>
						)}
					</div>

					{editError ? (
						<p className="mb-3 whitespace-pre-line text-body-sm text-error" role="alert">
							{editError}
						</p>
					) : null}
					{actionError ? (
						<p className="mb-3 whitespace-pre-line text-body-sm text-error" role="alert">
							{actionError}
						</p>
					) : null}

					<Tabs.Panel className="pt-0 outline-none" id="steps">
						{view === "steps" ? (
							<div className={reduceMotion ? undefined : "motion-fade-up"} key="steps-panel">
								<ol className="m-0 flex list-none flex-col gap-3 p-0">
									{steps.map((action, index) => {
										const isDragging = draggingIndex === index;
										return (
											<li
												className={[
													"flex items-start gap-3 rounded-xl border border-outline-variant/70 bg-surface-container-lowest px-3.5 py-3 transition-[transform,opacity,box-shadow,border-color] duration-[var(--motion-fast)]",
													isDragging
														? "scale-[0.99] border-primary/30 opacity-60 shadow-float"
														: "",
												]
													.filter(Boolean)
													.join(" ")}
												key={`${action.type}-${index}-${action.reason ?? ""}`}
												onDragOver={(event) => {
													event.preventDefault();
													event.dataTransfer.dropEffect = "move";
													if (draggingIndex === null || draggingIndex === index) return;
													panel$.steps.set((current) => {
														const next = [...current];
														const [moved] = next.splice(draggingIndex, 1);
														if (!moved) return current;
														next.splice(index, 0, moved);
														return next;
													});
													panel$.draggingIndex.set(index);
												}}
												onDrop={(event) => {
													event.preventDefault();
													void finishReorder();
												}}
											>
												<button
													aria-label={`Drag to rearrange step ${index + 1}`}
													className={[
														"flex shrink-0 cursor-grab flex-col items-center justify-center gap-1.5 self-stretch rounded-xl border border-outline-variant bg-surface-container px-2 py-2.5 text-on-surface shadow-card transition-colors duration-[var(--motion-fast)]",
														"hover:border-primary/30 hover:bg-surface-container-high",
														"active:cursor-grabbing active:bg-surface-container-highest",
														isDragging ? "border-primary/40 bg-surface-container-high" : "",
														busy ? "pointer-events-none opacity-50" : "",
													].join(" ")}
													draggable={!busy}
													onDragEnd={() => {
														void finishReorder();
													}}
													onDragStart={(event) => {
														event.dataTransfer.effectAllowed = "move";
														event.dataTransfer.setData("text/plain", String(index));
														if (event.currentTarget.parentElement) {
															event.dataTransfer.setDragImage(
																event.currentTarget.parentElement,
																24,
																24,
															);
														}
														panel$.draggingIndex.set(index);
													}}
													title="Drag to rearrange"
													type="button"
												>
													<GripIcon className="size-4" />
													<span
														aria-hidden="true"
														className="flex size-7 items-center justify-center rounded-full bg-primary text-helper font-bold text-on-primary transition-transform duration-[var(--motion-fast)]"
													>
														{index + 1}
													</span>
												</button>

												<div className="min-w-0 flex-1">
													<div className="flex flex-wrap items-center gap-2">
														<span className="rounded-md bg-surface-container px-2 py-0.5 text-helper font-semibold uppercase tracking-wide text-on-surface">
															{action.type}
														</span>
														<span className="text-body-md font-medium text-on-surface">
															{scriptActionSummary(action)}
														</span>
													</div>
													{action.reason ? (
														<p className="mt-1 text-body-sm text-on-surface-variant">
															{action.reason}
														</p>
													) : null}
												</div>

												<button
													aria-label={`Delete step ${index + 1}`}
													className="flex size-8 shrink-0 items-center justify-center self-start rounded-lg text-on-surface-variant transition-colors duration-[var(--motion-fast)] hover:bg-error-container/50 hover:text-error disabled:opacity-40"
													disabled={busy}
													onClick={() => void deleteStep(index)}
													title={
														steps.length === 1
															? "Delete this step (removes the whole script)"
															: "Delete step"
													}
													type="button"
												>
													<TrashIcon className="size-4" />
												</button>
											</li>
										);
									})}
								</ol>
							</div>
						) : null}
					</Tabs.Panel>

					<Tabs.Panel className="pt-0 outline-none" id="yaml">
						{view === "yaml" ? (
							<div
								className={
									reduceMotion ? "flex flex-col gap-2" : "motion-fade-up flex flex-col gap-2"
								}
								key={`yaml-${editing ? "edit" : "view"}`}
							>
								{editing ? (
									<textarea
										aria-label="Case Script file (YAML)"
										className={`${fieldAreaClass} min-h-[22rem] font-mono text-body-sm leading-relaxed`}
										onChange={(event) => panel$.draft.set(event.target.value)}
										spellCheck={false}
										value={draft}
									/>
								) : (
									<pre className="max-h-[28rem] overflow-auto rounded-xl border border-outline-variant bg-surface-container px-4 py-3 font-mono text-body-sm leading-relaxed text-on-surface">
										{formatCaseScriptFile(script).trimEnd()}
									</pre>
								)}
								<p className="text-body-sm text-on-surface-variant">
									Replay with{" "}
									<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">
										yoqa script run {baseName}
										{CASE_SCRIPT_FILE_EXTENSION}
									</code>{" "}
									after connecting a device.
								</p>
							</div>
						) : null}
					</Tabs.Panel>

					<Tabs.Panel className="pt-0 outline-none" id="shell">
						{view === "shell" ? (
							<div
								className={
									reduceMotion ? "flex flex-col gap-2" : "motion-fade-up flex flex-col gap-2"
								}
								key="shell-panel"
							>
								<pre className="max-h-[28rem] overflow-auto rounded-xl border border-outline-variant bg-surface-container px-4 py-3 font-mono text-body-sm leading-relaxed text-on-surface">
									{formatCaseScriptShell(script, exportMeta).trimEnd()}
								</pre>
								<p className="text-body-sm text-on-surface-variant">
									Shell export calls{" "}
									<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">
										yoqa action
									</code>{" "}
									and{" "}
									<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">
										sleep
									</code>
									. Prefer the Case Script file +{" "}
									<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">
										yoqa script run
									</code>{" "}
									for structured replay.
								</p>
							</div>
						) : null}
					</Tabs.Panel>
				</Tabs>
			</section>

			<AlertDialog>
				<AlertDialog.Backdrop
					isOpen={deleteOpen}
					onOpenChange={(open) => panel$.deleteOpen.set(open)}
				>
					<AlertDialog.Container>
						<AlertDialog.Dialog className="sm:max-w-[400px]">
							<AlertDialog.CloseTrigger />
							<AlertDialog.Header>
								<AlertDialog.Icon status="danger" />
								<AlertDialog.Heading>Delete saved script?</AlertDialog.Heading>
							</AlertDialog.Header>
							<AlertDialog.Body>
								<p>
									This removes the replayable script for{" "}
									<strong>
										#{caseNumber} {caseName}
									</strong>
									. Future runs will use the AI agent until a new script is saved.
								</p>
							</AlertDialog.Body>
							<AlertDialog.Footer>
								<Button slot="close" variant="tertiary">
									Cancel
								</Button>
								<Button
									isDisabled={busy}
									onPress={() => {
										void (async () => {
											panel$.actionError.set(null);
											try {
												await onDeleteScript();
												panel$.deleteOpen.set(false);
											} catch (error) {
												panel$.actionError.set(
													error instanceof Error ? error.message : "Failed to delete script",
												);
												panel$.deleteOpen.set(false);
											}
										})();
									}}
									variant="danger"
								>
									Delete script
								</Button>
							</AlertDialog.Footer>
						</AlertDialog.Dialog>
					</AlertDialog.Container>
				</AlertDialog.Backdrop>
			</AlertDialog>
		</div>
	);
}
