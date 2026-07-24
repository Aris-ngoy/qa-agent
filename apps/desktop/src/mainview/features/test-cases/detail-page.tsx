import { RhfSelectField, RhfTextField, requiredTrimmed } from "@/app/forms";
import { getRunnerClient } from "@/app/runner-client";
import {
	type TestCase,
	type TestFlow,
	caseQueryKey,
	casesQueryKey,
	mapCatalogCase,
} from "@/features/test-cases/data";
import { useTestCaseSelection } from "@/features/test-cases/selection-context";
import { AlertDialog, Button, Form } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import {
	type CaseScript,
	type CaseScriptAction,
	caseScriptSchema,
	formatCaseScriptJson,
	formatCaseScriptShell,
	suggestedScriptBasename,
} from "@yoqa/runner-client";
import { type SVGProps, useEffect, useRef, useState } from "react";
import {
	type Control,
	type UseFormSetValue,
	useFieldArray,
	useForm,
	useWatch,
} from "react-hook-form";

type DetailTab = "instructions" | "configuration" | "script";

type Capability = {
	id: string;
	key: string;
	value: string;
};

type GalleryImage = {
	id: string;
	name: string;
};

type FormValues = {
	name: string;
	tags: string[];
	flows: TestFlow[];
	capabilities: Capability[];
	galleryImages: GalleryImage[];
	locale: string | null;
};

const TABS: { id: DetailTab; label: string }[] = [
	{ id: "instructions", label: "Instructions" },
	{ id: "configuration", label: "Configuration" },
	{ id: "script", label: "Script" },
];

const LOCALES = [
	{ id: "en-US", label: "English (United States)" },
	{ id: "en-GB", label: "English (United Kingdom)" },
	{ id: "fr-FR", label: "French (France)" },
	{ id: "de-DE", label: "German (Germany)" },
	{ id: "es-ES", label: "Spanish (Spain)" },
	{ id: "ja-JP", label: "Japanese (Japan)" },
	{ id: "pt-BR", label: "Portuguese (Brazil)" },
] as const;

const fieldInputClass =
	"w-full !rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md text-on-surface shadow-none placeholder:text-on-surface-variant/65 focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/10";

const fieldAreaClass =
	"w-full !rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2 text-body-md text-on-surface shadow-none placeholder:text-on-surface-variant/65 focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/10 min-h-[3.25rem] resize-y";

const actionLinkClass =
	"inline-flex items-center gap-1.5 text-body-md font-medium text-on-surface transition-colors hover:text-primary";

const configCardClass =
	"w-full rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card";

const softButtonClass =
	"inline-flex items-center justify-center gap-2 rounded-xl bg-surface-container px-4 py-2.5 text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high";

function Icon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-4"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		/>
	);
}

function GripIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 20 20" {...props}>
			<path d="M7 4a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm9-12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm0 6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
		</svg>
	);
}

function TrashIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path
				d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function DuplicateIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<rect height="12" rx="2" width="12" x="8" y="8" />
			<path d="M6 16V6a2 2 0 0 1 2-2h10" strokeLinecap="round" />
		</svg>
	);
}

function formFromCase(testCase: TestCase): FormValues {
	return {
		name: testCase.name,
		tags: [...testCase.tags],
		flows: testCase.flows.map((flow) => ({ ...flow })),
		capabilities: testCase.capabilities.map((cap) => ({ ...cap })),
		galleryImages: [],
		locale: null,
	};
}

function InstructionsPanel({
	control,
	setValue,
}: {
	control: Control<FormValues>;
	setValue: UseFormSetValue<FormValues>;
}) {
	const [tagDraft, setTagDraft] = useState("");
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const tags = useWatch({ control, name: "tags" }) ?? [];
	const {
		fields: flowFields,
		append,
		remove,
		move,
	} = useFieldArray({
		control,
		name: "flows",
		keyName: "fieldId",
	});
	const canDeleteFlow = flowFields.length > 1;

	const commitTag = () => {
		const next = tagDraft.trim();
		if (!next) return;
		const normalized = next.toLowerCase();
		if (tags.some((existing) => existing.toLowerCase() === normalized)) {
			setTagDraft("");
			return;
		}
		setValue("tags", [...tags, next], { shouldDirty: true });
		setTagDraft("");
	};

	return (
		<div className="grid w-full grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
			<div className="flex min-w-0 flex-col gap-6">
				<div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
					<RhfTextField
						control={control}
						inputClassName={fieldInputClass}
						label={
							<>
								Test case name <span className="text-error">*</span>
							</>
						}
						name="name"
						placeholder="Test case name"
						rules={requiredTrimmed("Test case name is required")}
					/>

					<div>
						<label className="mb-1.5 block text-subheading text-on-surface" htmlFor="case-tags">
							Tags
						</label>
						<div className="flex min-h-[3rem] flex-wrap items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2">
							{tags.map((tag) => (
								<span
									className="inline-flex items-center gap-1 rounded-md bg-error-container px-2 py-0.5 text-helper font-medium text-on-error-container"
									key={tag}
								>
									{tag}
									<button
										aria-label={`Remove ${tag}`}
										className="rounded p-0.5 text-on-error-container/80 transition-colors hover:text-on-error-container"
										onClick={() =>
											setValue(
												"tags",
												tags.filter((existing) => existing !== tag),
												{ shouldDirty: true },
											)
										}
										type="button"
									>
										<svg
											aria-hidden="true"
											className="size-3"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											viewBox="0 0 24 24"
										>
											<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
										</svg>
									</button>
								</span>
							))}
							<input
								className="min-w-[6rem] flex-1 border-none bg-transparent px-1 py-0.5 text-body-md text-on-surface outline-none placeholder:text-on-surface-variant/55"
								id="case-tags"
								onChange={(event) => setTagDraft(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === ",") {
										event.preventDefault();
										commitTag();
									}
									if (event.key === "Backspace" && !tagDraft && tags.length > 0) {
										const lastTag = tags[tags.length - 1];
										if (lastTag) {
											setValue(
												"tags",
												tags.filter((existing) => existing !== lastTag),
												{ shouldDirty: true },
											);
										}
									}
								}}
								placeholder={tags.length === 0 ? "Add a tag" : ""}
								type="text"
								value={tagDraft}
							/>
						</div>
					</div>
				</div>

				<div className="flex flex-col gap-4">
					<ul className="m-0 flex list-none flex-col gap-4 p-0">
						{flowFields.map((flow, index) => {
							const isDragging = draggingIndex === index;

							return (
								<li
									className={[
										"flex items-start gap-3 rounded-2xl border border-outline-variant/70 bg-surface-container-lowest/80 p-3 shadow-card transition-all",
										isDragging ? "scale-[0.99] border-primary/30 opacity-60 shadow-float" : "",
									]
										.filter(Boolean)
										.join(" ")}
									key={flow.fieldId}
									onDragOver={(event) => {
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
										if (draggingIndex === null || draggingIndex === index) return;
										move(draggingIndex, index);
										setDraggingIndex(index);
									}}
									onDrop={(event) => {
										event.preventDefault();
										setDraggingIndex(null);
									}}
								>
									<button
										aria-label={`Drag to rearrange step ${index + 1}`}
										className={[
											"flex shrink-0 cursor-grab flex-col items-center justify-center gap-1.5 self-stretch rounded-xl border border-outline-variant bg-surface-container px-2 py-2.5 text-on-surface shadow-card transition-colors",
											"hover:border-primary/30 hover:bg-surface-container-high hover:text-on-surface",
											"active:cursor-grabbing active:bg-surface-container-highest",
											isDragging ? "border-primary/40 bg-surface-container-high" : "",
										].join(" ")}
										draggable
										onDragEnd={() => setDraggingIndex(null)}
										onDragStart={(event) => {
											event.dataTransfer.effectAllowed = "move";
											event.dataTransfer.setData("text/plain", String(index));
											if (event.currentTarget.parentElement) {
												event.dataTransfer.setDragImage(event.currentTarget.parentElement, 24, 24);
											}
											setDraggingIndex(index);
										}}
										title="Drag to rearrange"
										type="button"
									>
										<GripIcon className="size-4" />
										<span
											aria-hidden="true"
											className="flex size-7 items-center justify-center rounded-full bg-primary text-helper font-bold text-on-primary"
										>
											{index + 1}
										</span>
									</button>

									<div className="grid min-w-0 flex-1 grid-cols-1 gap-3 md:grid-cols-2">
										<RhfTextField
											control={control}
											inputClassName={fieldAreaClass}
											label="Instructions"
											multiline
											name={`flows.${index}.instructions`}
											placeholder="Describe what the agent should do…"
											rows={2}
										/>
										<RhfTextField
											control={control}
											inputClassName={fieldAreaClass}
											label="Expected result"
											multiline
											name={`flows.${index}.expectedResult`}
											placeholder="What should be true when this step succeeds…"
											rows={2}
										/>
									</div>

									{canDeleteFlow ? (
										<button
											aria-label={`Delete step ${index + 1}`}
											className="flex size-8 shrink-0 items-center justify-center self-start rounded-lg text-on-surface-variant transition-colors hover:bg-error-container/50 hover:text-error"
											onClick={() => remove(index)}
											title="Delete step"
											type="button"
										>
											<TrashIcon className="size-4" />
										</button>
									) : null}
								</li>
							);
						})}
					</ul>

					<div className="flex shrink-0 flex-wrap items-center gap-5 pl-12">
						<button
							className={actionLinkClass}
							onClick={() =>
								append({
									id: `cf_${crypto.randomUUID()}`,
									instructions: "",
									expectedResult: "",
								})
							}
							type="button"
						>
							<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 20 20">
								<path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
							</svg>
							Add flow
						</button>
						<button className={actionLinkClass} type="button">
							<Icon>
								<path
									d="M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 6"
									strokeLinecap="round"
								/>
								<path
									d="M14 11a5 5 0 0 0-7.07 0L5.52 12.41a5 5 0 0 0 7.07 7.07L14 18"
									strokeLinecap="round"
								/>
							</Icon>
							Add reusable flow
							<svg
								aria-hidden="true"
								className="size-3.5 text-on-surface-variant"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								viewBox="0 0 24 24"
							>
								<path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
						</button>
						<button className={actionLinkClass} type="button">
							<Icon>
								<path
									d="M12 3v12M8 11l4 4 4-4M5 19h14"
									strokeLinecap="round"
									strokeLinejoin="round"
								/>
							</Icon>
							Bulk import
						</button>
					</div>
				</div>
			</div>

			<aside className="h-fit rounded-2xl bg-[#f7f1d8] p-5 xl:sticky xl:top-2">
				<div className="mb-3 flex size-8 items-center justify-center rounded-full bg-[#efd978]/80 text-[#8a6d12]">
					<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
						<path d="M9 21h6v-1.5H9V21zm3-19a6 6 0 00-3.5 10.9c.6.4 1 1 1.1 1.7V17h4.8v-2.4c.1-.7.5-1.3 1.1-1.7A6 6 0 0012 2z" />
					</svg>
				</div>
				<p className="mb-4 text-body-sm leading-relaxed text-on-surface">
					Learn how to write effective test cases that produce reliable, reproducible results.
				</p>
				<a
					className="inline-flex items-center gap-1.5 text-body-sm font-medium text-on-surface underline-offset-2 hover:underline"
					href="https://docs.noqa.ai"
					rel="noreferrer"
					target="_blank"
				>
					Writing good test cases
					<svg
						aria-hidden="true"
						className="size-3.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.75"
						viewBox="0 0 24 24"
					>
						<path
							d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6v6M10 14L20 4"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</a>
			</aside>
		</div>
	);
}

function ConfigurationPanel({
	control,
	setValue,
}: {
	control: Control<FormValues>;
	setValue: UseFormSetValue<FormValues>;
}) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const galleryImages = useWatch({ control, name: "galleryImages" }) ?? [];
	const {
		fields: capabilityFields,
		append,
		remove,
	} = useFieldArray({
		control,
		name: "capabilities",
		keyName: "fieldId",
	});

	return (
		<div className="flex w-full max-w-2xl flex-col gap-5">
			<section className={configCardClass}>
				<div className="mb-5">
					<h2 className="mb-1.5 text-headline-md text-on-surface">Appium Capabilities</h2>
					<p className="text-body-md text-on-surface-variant">
						Custom capabilities passed to the driver. Overrides app-level capabilities.
					</p>
				</div>

				{capabilityFields.length > 0 ? (
					<ul className="mb-4 flex list-none flex-col gap-3 p-0">
						{capabilityFields.map((cap, index) => (
							<li className="flex items-start gap-2" key={cap.fieldId}>
								<RhfTextField
									aria-label="Capability key"
									className="min-w-0 flex-1"
									control={control}
									inputClassName={fieldInputClass}
									name={`capabilities.${index}.key`}
									placeholder="appium:autoLaunch"
								/>
								<RhfTextField
									aria-label="Capability value"
									className="min-w-0 flex-1"
									control={control}
									inputClassName={fieldInputClass}
									name={`capabilities.${index}.value`}
									placeholder="false"
								/>
								<Button
									aria-label="Remove capability"
									className="size-10 min-w-10 shrink-0 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
									onPress={() => remove(index)}
									type="button"
									variant="ghost"
								>
									<TrashIcon />
								</Button>
							</li>
						))}
					</ul>
				) : null}

				<button
					className={softButtonClass}
					onClick={() => append({ id: `cap_${crypto.randomUUID()}`, key: "", value: "" })}
					type="button"
				>
					<svg aria-hidden="true" className="size-[18px]" fill="currentColor" viewBox="0 0 20 20">
						<path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
					</svg>
					Add capability
				</button>
			</section>

			<section className={configCardClass}>
				<h2 className="mb-6 text-headline-md text-on-surface">Cloud</h2>

				<div className="mb-8">
					<h3 className="mb-1 text-subheading font-semibold text-on-surface">Gallery images</h3>
					<p className="mb-4 text-body-md text-on-surface-variant">
						Images added here will be pre-loaded into the device gallery before the test runs.
					</p>

					{galleryImages.length > 0 ? (
						<ul className="mb-3 flex list-none flex-wrap gap-2 p-0">
							{galleryImages.map((image) => (
								<li
									className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container px-2.5 py-1.5 text-body-sm text-on-surface"
									key={image.id}
								>
									<span className="max-w-[12rem] truncate">{image.name}</span>
									<button
										aria-label={`Remove ${image.name}`}
										className="rounded p-0.5 text-on-surface-variant transition-colors hover:text-error"
										onClick={() =>
											setValue(
												"galleryImages",
												galleryImages.filter((item) => item.id !== image.id),
												{ shouldDirty: true },
											)
										}
										type="button"
									>
										<svg
											aria-hidden="true"
											className="size-3.5"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											viewBox="0 0 24 24"
										>
											<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
										</svg>
									</button>
								</li>
							))}
						</ul>
					) : null}

					<input
						accept="image/*"
						className="sr-only"
						multiple
						onChange={(event) => {
							if (event.target.files && event.target.files.length > 0) {
								const nextImages = Array.from(event.target.files).map((file) => ({
									id: `img_${crypto.randomUUID()}`,
									name: file.name,
								}));
								setValue("galleryImages", [...galleryImages, ...nextImages], {
									shouldDirty: true,
								});
								event.target.value = "";
							}
						}}
						ref={fileInputRef}
						type="file"
					/>
					<button
						className={`${softButtonClass} w-full`}
						onClick={() => fileInputRef.current?.click()}
						type="button"
					>
						<svg
							aria-hidden="true"
							className="size-4"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<path
								d="M12 16V4M8 8l4-4 4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
						Upload image
					</button>
				</div>

				<div>
					<h3 className="mb-1 text-subheading font-semibold text-on-surface">Locale</h3>
					<p className="mb-4 text-body-md text-on-surface-variant">
						Override the device locale for this test case.
					</p>
					<RhfSelectField
						ariaLabel="Select locale"
						control={control}
						name="locale"
						nullable
						options={LOCALES}
						placeholder="Select locale…"
					/>
				</div>
			</section>
		</div>
	);
}

function formatScriptSavedAt(ms: number): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(new Date(ms));
}

function scriptActionSummary(action: CaseScriptAction): string {
	if (action.type === "tap") {
		return `Tap at (${Math.round(action.x)}, ${Math.round(action.y)})`;
	}
	if (action.type === "type") {
		return `Type “${action.text}”`;
	}
	return `Wait ${action.ms}ms`;
}

function downloadTextFile(filename: string, contents: string, mime: string) {
	const blob = new Blob([contents], { type: mime });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	anchor.click();
	URL.revokeObjectURL(url);
}

type ScriptViewMode = "steps" | "json" | "shell";

function ScriptPanel({
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
	const [view, setView] = useState<ScriptViewMode>("steps");
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [editError, setEditError] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const [steps, setSteps] = useState<CaseScriptAction[]>([]);
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const stepsRef = useRef(steps);
	stepsRef.current = steps;

	const exportMeta = { caseNumber, caseName };

	useEffect(() => {
		if (!editing && script) {
			setDraft(formatCaseScriptJson(script).trimEnd());
			setEditError(null);
		}
	}, [script, editing]);

	useEffect(() => {
		if (!script || draggingIndex !== null) return;
		setSteps(script.actions.map((action) => ({ ...action })));
	}, [script, draggingIndex]);

	if (!script) {
		return (
			<div className={`${configCardClass} max-w-2xl`}>
				<h2 className="mb-1.5 text-headline-md text-on-surface">Saved script</h2>
				<p className="text-body-md text-on-surface-variant">
					No script yet. After a successful AI agent run, YoQA saves the tap, type, and wait actions
					here so you can replay the case without calling the model.
				</p>
			</div>
		);
	}

	const savedLabel = formatScriptSavedAt(scriptSavedAt ?? script.savedAt);
	const baseName = suggestedScriptBasename(exportMeta);

	const persistSteps = async (next: CaseScriptAction[]) => {
		setActionError(null);
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
		setDraft(formatCaseScriptJson(script).trimEnd());
		setEditError(null);
		setActionError(null);
		setEditing(true);
		setView("json");
	};

	const cancelEdit = () => {
		setEditing(false);
		setEditError(null);
		setDraft(formatCaseScriptJson(script).trimEnd());
	};

	const saveEdit = async () => {
		setEditError(null);
		setActionError(null);
		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(draft) as unknown;
		} catch {
			setEditError("Invalid JSON");
			return;
		}
		const parsed = caseScriptSchema.safeParse(parsedJson);
		if (!parsed.success) {
			setEditError(parsed.error.issues[0]?.message ?? "Invalid CaseScript");
			return;
		}
		try {
			await onSaveScript(parsed.data);
			setEditing(false);
		} catch (error) {
			setActionError(error instanceof Error ? error.message : "Failed to save script");
		}
	};

	const exportJson = () => {
		downloadTextFile(`${baseName}.yoqa.json`, formatCaseScriptJson(script), "application/json");
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
		setSteps(next);
		try {
			await persistSteps(next);
		} catch (error) {
			setSteps(script.actions.map((action) => ({ ...action })));
			setActionError(error instanceof Error ? error.message : "Failed to delete step");
		}
	};

	const finishReorder = async () => {
		setDraggingIndex(null);
		const next = stepsRef.current;
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
			setSteps(script.actions.map((action) => ({ ...action })));
			setActionError(error instanceof Error ? error.message : "Failed to reorder steps");
		}
	};

	const viewTabs: { id: ScriptViewMode; label: string }[] = [
		{ id: "steps", label: "Steps" },
		{ id: "json", label: "JSON" },
		{ id: "shell", label: "CLI shell" },
	];

	return (
		<div className="flex w-full max-w-2xl flex-col gap-5">
			<section className={configCardClass}>
				<div className="mb-5 flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 className="mb-1.5 text-headline-md text-on-surface">Saved script</h2>
						<p className="text-body-md text-on-surface-variant">
							Replayable actions from a successful agent run. Used by default when you press Run.
						</p>
					</div>
					<span className="rounded-full bg-secondary-container/70 px-3 py-1 text-helper font-semibold text-on-secondary-container">
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

				<div className="mb-4 flex flex-wrap items-center gap-2">
					{viewTabs.map((tab) => {
						const isActive = view === tab.id;
						return (
							<button
								className={
									isActive
										? "rounded-lg bg-primary px-3 py-1.5 text-body-sm font-semibold text-on-primary"
										: "rounded-lg bg-surface-container px-3 py-1.5 text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high"
								}
								disabled={editing && tab.id !== "json"}
								key={tab.id}
								onClick={() => setView(tab.id)}
								type="button"
							>
								{tab.label}
							</button>
						);
					})}
				</div>

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
								Edit JSON
							</Button>
							<Button
								className="rounded-lg"
								isDisabled={busy}
								onPress={exportJson}
								variant="secondary"
							>
								Export JSON
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
								onPress={() => setDeleteOpen(true)}
								variant="ghost"
							>
								Delete all
							</Button>
						</>
					)}
				</div>

				{editError ? (
					<p className="mb-3 text-body-sm text-error" role="alert">
						{editError}
					</p>
				) : null}
				{actionError ? (
					<p className="mb-3 text-body-sm text-error" role="alert">
						{actionError}
					</p>
				) : null}

				{editing || view === "json" ? (
					<div className="flex flex-col gap-2">
						{editing ? (
							<textarea
								aria-label="CaseScript JSON"
								className={`${fieldAreaClass} min-h-[22rem] font-mono text-body-sm leading-relaxed`}
								onChange={(event) => setDraft(event.target.value)}
								spellCheck={false}
								value={draft}
							/>
						) : (
							<pre className="max-h-[28rem] overflow-auto rounded-xl border border-outline-variant bg-surface-container px-4 py-3 font-mono text-body-sm leading-relaxed text-on-surface">
								{formatCaseScriptJson(script).trimEnd()}
							</pre>
						)}
						<p className="text-body-sm text-on-surface-variant">
							Replay with{" "}
							<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">
								yoqa script run {baseName}.yoqa.json
							</code>{" "}
							after connecting a device.
						</p>
					</div>
				) : null}

				{!editing && view === "shell" ? (
					<div className="flex flex-col gap-2">
						<pre className="max-h-[28rem] overflow-auto rounded-xl border border-outline-variant bg-surface-container px-4 py-3 font-mono text-body-sm leading-relaxed text-on-surface">
							{formatCaseScriptShell(script, exportMeta).trimEnd()}
						</pre>
						<p className="text-body-sm text-on-surface-variant">
							Shell export calls{" "}
							<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">
								yoqa action
							</code>{" "}
							and{" "}
							<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">sleep</code>.
							Prefer JSON +{" "}
							<code className="rounded bg-surface-container px-1.5 py-0.5 text-helper">
								yoqa script run
							</code>{" "}
							for structured replay.
						</p>
					</div>
				) : null}

				{!editing && view === "steps" ? (
					<ol className="m-0 flex list-none flex-col gap-3 p-0">
						{steps.map((action, index) => {
							const isDragging = draggingIndex === index;
							return (
								<li
									className={[
										"flex items-start gap-3 rounded-xl border border-outline-variant/70 bg-surface-container-lowest px-3.5 py-3 transition-all",
										isDragging ? "scale-[0.99] border-primary/30 opacity-60 shadow-float" : "",
									]
										.filter(Boolean)
										.join(" ")}
									key={`${action.type}-${index}-${action.reason ?? ""}`}
									onDragOver={(event) => {
										event.preventDefault();
										event.dataTransfer.dropEffect = "move";
										if (draggingIndex === null || draggingIndex === index) return;
										setSteps((current) => {
											const next = [...current];
											const [moved] = next.splice(draggingIndex, 1);
											if (!moved) return current;
											next.splice(index, 0, moved);
											return next;
										});
										setDraggingIndex(index);
									}}
									onDrop={(event) => {
										event.preventDefault();
										void finishReorder();
									}}
								>
									<button
										aria-label={`Drag to rearrange step ${index + 1}`}
										className={[
											"flex shrink-0 cursor-grab flex-col items-center justify-center gap-1.5 self-stretch rounded-xl border border-outline-variant bg-surface-container px-2 py-2.5 text-on-surface shadow-card transition-colors",
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
												event.dataTransfer.setDragImage(event.currentTarget.parentElement, 24, 24);
											}
											setDraggingIndex(index);
										}}
										title="Drag to rearrange"
										type="button"
									>
										<GripIcon className="size-4" />
										<span
											aria-hidden="true"
											className="flex size-7 items-center justify-center rounded-full bg-primary text-helper font-bold text-on-primary"
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
											<p className="mt-1 text-body-sm text-on-surface-variant">{action.reason}</p>
										) : null}
									</div>

									<button
										aria-label={`Delete step ${index + 1}`}
										className="flex size-8 shrink-0 items-center justify-center self-start rounded-lg text-on-surface-variant transition-colors hover:bg-error-container/50 hover:text-error disabled:opacity-40"
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
				) : null}
			</section>

			<AlertDialog>
				<AlertDialog.Backdrop isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
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
											setActionError(null);
											try {
												await onDeleteScript();
												setDeleteOpen(false);
											} catch (error) {
												setActionError(
													error instanceof Error ? error.message : "Failed to delete script",
												);
												setDeleteOpen(false);
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

const emptyDefaults: FormValues = {
	name: "",
	tags: [],
	flows: [],
	capabilities: [],
	galleryImages: [],
	locale: null,
};

export function TestCaseDetailPage() {
	const { caseId } = useParams({ strict: false }) as { caseId?: string };
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { setSelected } = useTestCaseSelection();
	const [activeTab, setActiveTab] = useState<DetailTab>("instructions");
	const [ready, setReady] = useState(false);

	const {
		control,
		handleSubmit,
		reset,
		getValues,
		setValue,
		formState: { isDirty },
	} = useForm<FormValues>({
		defaultValues: emptyDefaults,
		mode: "onChange",
	});

	const nameValue = useWatch({ control, name: "name" });

	useEffect(() => {
		if (caseId) {
			setSelected([caseId]);
		}
	}, [caseId, setSelected]);

	const caseQuery = useQuery({
		queryKey: caseId ? caseQueryKey(caseId) : ["catalog", "case", "none"],
		enabled: Boolean(caseId),
		queryFn: async () => {
			if (!caseId) throw new Error("Missing case id");
			const client = await getRunnerClient();
			return mapCatalogCase(await client.getCase(caseId));
		},
		retry: false,
	});

	const testCase = caseQuery.data;

	const saveMutation = useMutation({
		mutationFn: async (next: FormValues) => {
			if (!caseId) throw new Error("Missing case id");
			const client = await getRunnerClient();
			return mapCatalogCase(
				await client.updateCase(caseId, {
					name: next.name.trim(),
					tags: next.tags,
					flows: next.flows.map((flow) => ({
						id: flow.id.startsWith("cf_") ? flow.id : undefined,
						instructions: flow.instructions,
						expectedResult: flow.expectedResult,
						flowId: flow.flowId ?? null,
					})),
					capabilities: next.capabilities
						.map((cap) => ({ ...cap, key: cap.key.trim(), value: cap.value.trim() }))
						.filter((cap) => cap.key.length > 0),
				}),
			);
		},
		onSuccess: (updated) => {
			queryClient.setQueryData(caseQueryKey(updated.id), updated);
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(updated.appId) });
			reset(formFromCase(updated));
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!caseId || !testCase) throw new Error("Missing case");
			const client = await getRunnerClient();
			await client.deleteCase(caseId);
			return testCase.appId;
		},
		onSuccess: (appId) => {
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(appId) });
			void navigate({ to: "/test-cases" });
		},
	});

	const duplicateMutation = useMutation({
		mutationFn: async () => {
			if (!testCase) throw new Error("Missing case");
			const form = getValues();
			const client = await getRunnerClient();
			return mapCatalogCase(
				await client.createCase(testCase.appId, {
					name: `${form.name.trim() || testCase.name} (copy)`,
					tags: form.tags,
					flows: form.flows.map((flow) => ({
						instructions: flow.instructions,
						expectedResult: flow.expectedResult,
					})),
					capabilities: form.capabilities
						.map((cap) => ({ ...cap, key: cap.key.trim(), value: cap.value.trim() }))
						.filter((cap) => cap.key.length > 0),
				}),
			);
		},
		onSuccess: (created) => {
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(created.appId) });
			void navigate({ to: "/test-cases/$caseId", params: { caseId: created.id } });
		},
	});

	const scriptMutation = useMutation({
		mutationFn: async (script: CaseScript | null) => {
			if (!caseId) throw new Error("Missing case id");
			const client = await getRunnerClient();
			return mapCatalogCase(await client.updateCase(caseId, { script }));
		},
		onSuccess: (updated) => {
			queryClient.setQueryData(caseQueryKey(updated.id), updated);
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(updated.appId) });
		},
	});

	useEffect(() => {
		if (!testCase) {
			setReady(false);
			return;
		}
		reset(formFromCase(testCase));
		setReady(true);
		setActiveTab("instructions");
	}, [testCase, reset]);

	if (caseQuery.isLoading) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-16">
				<p className="text-body-md text-on-surface-variant">Loading test case…</p>
			</div>
		);
	}

	if (!testCase || caseQuery.isError) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-16">
				<h1 className="text-headline-lg text-on-surface">Test case not found</h1>
				<p className="text-body-md text-on-surface-variant">
					No case matches{" "}
					<code className="rounded bg-surface-container px-1.5 py-0.5 text-body-sm">
						{caseId ?? "unknown"}
					</code>
					.
				</p>
				<Link
					className="w-fit text-body-md font-semibold text-on-surface underline-offset-2 hover:underline"
					to="/test-cases"
				>
					Back to Test Cases
				</Link>
			</div>
		);
	}

	if (!ready) {
		return null;
	}

	const canSave = isDirty && (nameValue?.trim().length ?? 0) > 0 && !saveMutation.isPending;
	const breadcrumbTitle = `#${testCase.number} ${nameValue?.trim() || testCase.name}`;

	const onSubmit = (values: FormValues) => {
		saveMutation.mutate({
			...values,
			name: values.name.trim(),
			capabilities: values.capabilities
				.map((cap) => ({ ...cap, key: cap.key.trim(), value: cap.value.trim() }))
				.filter((cap) => cap.key.length > 0),
		});
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col gap-6">
			<header className="motion-fade-up flex shrink-0 flex-wrap items-center justify-between gap-4">
				<nav className="flex min-w-0 items-center gap-2 text-body-md text-on-surface-variant">
					<Link
						className="shrink-0 transition-colors duration-[var(--motion-fast)] hover:text-on-surface"
						to="/test-cases"
					>
						Test Cases
					</Link>
					<span aria-hidden="true">&gt;</span>
					<span className="truncate font-medium text-on-surface">{breadcrumbTitle}</span>
				</nav>

				<div className="flex items-center gap-1">
					<Button
						aria-label="Delete test case"
						className="size-10 min-w-10 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
						isDisabled={deleteMutation.isPending}
						onPress={() => deleteMutation.mutate()}
						variant="ghost"
					>
						<TrashIcon />
					</Button>
					<Button
						aria-label="Duplicate test case"
						className="size-10 min-w-10 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-surface-container"
						isDisabled={duplicateMutation.isPending}
						onPress={() => duplicateMutation.mutate()}
						variant="ghost"
					>
						<DuplicateIcon />
					</Button>
					<Button
						className="ml-1 rounded-lg bg-primary px-5 text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
						form="test-case-form"
						isDisabled={!canSave}
						type="submit"
					>
						{saveMutation.isPending ? "Saving…" : "Save"}
					</Button>
				</div>
			</header>

			<div
				className="flex shrink-0 items-center gap-8 border-b border-outline-variant"
				role="tablist"
			>
				{TABS.map((tab) => {
					const isActive = tab.id === activeTab;
					return (
						<button
							aria-selected={isActive}
							className={
								isActive
									? "border-b-2 border-primary pb-3 text-body-md font-semibold text-on-surface"
									: "pb-3 text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
							}
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							role="tab"
							type="button"
						>
							{tab.label}
						</button>
					);
				})}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto pb-4" role="tabpanel">
				<Form className="contents" id="test-case-form" onSubmit={handleSubmit(onSubmit)}>
					{activeTab === "instructions" ? (
						<InstructionsPanel control={control} setValue={setValue} />
					) : null}
					{activeTab === "configuration" ? (
						<ConfigurationPanel control={control} setValue={setValue} />
					) : null}
				</Form>
				{activeTab === "script" ? (
					<ScriptPanel
						busy={scriptMutation.isPending}
						caseName={testCase.name}
						caseNumber={testCase.number}
						onDeleteScript={async () => {
							await scriptMutation.mutateAsync(null);
						}}
						onSaveScript={async (next) => {
							await scriptMutation.mutateAsync(next);
						}}
						script={testCase.script}
						scriptSavedAt={testCase.scriptSavedAt}
					/>
				) : null}
			</div>
		</div>
	);
}
