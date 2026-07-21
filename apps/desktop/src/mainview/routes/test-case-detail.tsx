import { Button, Input, Label, TextArea, TextField } from "@heroui/react";
import { Link, useParams } from "@tanstack/react-router";
import { type SVGProps, useEffect, useState } from "react";
import { type TestCase, type TestFlow, getTestCase } from "../test-cases-data";

type DetailTab = "instructions" | "configuration";

type Capability = {
	id: string;
	key: string;
	value: string;
};

type FormState = {
	name: string;
	tags: string[];
	flows: TestFlow[];
	capabilities: Capability[];
};

const TABS: { id: DetailTab; label: string }[] = [
	{ id: "instructions", label: "Instructions" },
	{ id: "configuration", label: "Configuration" },
];

const fieldInputClass =
	"w-full !rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md text-on-surface shadow-none placeholder:text-on-surface-variant/65 focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/10";

const fieldAreaClass = `${fieldInputClass} min-h-28 resize-y`;

const actionLinkClass =
	"inline-flex items-center gap-1.5 text-body-md font-medium text-on-surface transition-colors hover:text-primary";

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

function formFromCase(testCase: TestCase): FormState {
	return {
		name: testCase.name,
		tags: [...testCase.tags],
		flows: testCase.flows.map((flow) => ({ ...flow })),
		capabilities: [],
	};
}

function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
	if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
	const next = [...items];
	const [moved] = next.splice(fromIndex, 1);
	if (moved === undefined) return items;
	next.splice(toIndex, 0, moved);
	return next;
}

function InstructionsPanel({
	form,
	onNameChange,
	onRemoveTag,
	onAddTag,
	onFlowChange,
	onAddFlow,
	onMoveFlow,
	onRemoveFlow,
}: {
	form: FormState;
	onNameChange: (name: string) => void;
	onRemoveTag: (tag: string) => void;
	onAddTag: (tag: string) => void;
	onFlowChange: (
		id: string,
		patch: Partial<Pick<TestFlow, "instructions" | "expectedResult">>,
	) => void;
	onAddFlow: () => void;
	onMoveFlow: (fromIndex: number, toIndex: number) => void;
	onRemoveFlow: (id: string) => void;
}) {
	const [tagDraft, setTagDraft] = useState("");
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const canDeleteFlow = form.flows.length > 1;

	const commitTag = () => {
		const next = tagDraft.trim();
		if (!next) return;
		onAddTag(next);
		setTagDraft("");
	};

	return (
		<div className="grid h-full min-h-0 w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
			<div className="flex min-h-0 min-w-0 flex-col gap-6">
				<div className="grid w-full grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
					<TextField className="w-full" name="caseName" onChange={onNameChange} value={form.name}>
						<Label className="mb-1.5 text-subheading text-on-surface">
							Test case name <span className="text-error">*</span>
						</Label>
						<Input className={fieldInputClass} placeholder="Test case name" />
					</TextField>

					<div>
						<label className="mb-1.5 block text-subheading text-on-surface" htmlFor="case-tags">
							Tags
						</label>
						<div className="flex min-h-[3rem] flex-wrap items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2">
							{form.tags.map((tag) => (
								<span
									className="inline-flex items-center gap-1 rounded-md bg-error-container px-2 py-0.5 text-helper font-medium text-on-error-container"
									key={tag}
								>
									{tag}
									<button
										aria-label={`Remove ${tag}`}
										className="rounded p-0.5 text-on-error-container/80 transition-colors hover:text-on-error-container"
										onClick={() => onRemoveTag(tag)}
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
									if (event.key === "Backspace" && !tagDraft && form.tags.length > 0) {
										const lastTag = form.tags[form.tags.length - 1];
										if (lastTag) onRemoveTag(lastTag);
									}
								}}
								placeholder={form.tags.length === 0 ? "Add a tag" : ""}
								type="text"
								value={tagDraft}
							/>
						</div>
					</div>
				</div>

				<ul className="flex min-h-0 flex-1 list-none flex-col gap-4 p-0">
					{form.flows.map((flow, index) => {
						const isEmpty = !flow.instructions.trim() && !flow.expectedResult.trim();
						const isDragging = draggingIndex === index;

						return (
							<li
								className={[
									"flex min-h-[11rem] flex-1 gap-3 rounded-2xl border border-outline-variant/70 bg-surface-container-lowest/80 p-3 shadow-card transition-all",
									isDragging ? "scale-[0.99] border-primary/30 opacity-60 shadow-float" : "",
									isEmpty && !isDragging ? "opacity-80" : "",
								]
									.filter(Boolean)
									.join(" ")}
								key={flow.id}
								onDragOver={(event) => {
									event.preventDefault();
									event.dataTransfer.dropEffect = "move";
									if (draggingIndex === null || draggingIndex === index) return;
									onMoveFlow(draggingIndex, index);
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
										"flex shrink-0 cursor-grab flex-col items-center justify-center gap-2 self-stretch rounded-xl border border-outline-variant bg-surface-container px-2.5 py-3 text-on-surface shadow-card transition-colors",
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
									<GripIcon />
									<span
										aria-hidden="true"
										className="flex size-8 items-center justify-center rounded-full bg-primary text-body-sm font-bold text-on-primary"
									>
										{index + 1}
									</span>
								</button>

								<div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 md:grid-cols-2">
									<TextField
										className="flex h-full min-h-0 w-full flex-col"
										name={`instructions-${flow.id}`}
										onChange={(value) => onFlowChange(flow.id, { instructions: value })}
										value={flow.instructions}
									>
										<Label className="mb-1.5 text-subheading text-on-surface">Instructions</Label>
										<TextArea
											className={`${fieldAreaClass} min-h-[8rem] flex-1`}
											placeholder="Describe what the agent should do…"
											rows={5}
										/>
									</TextField>
									<TextField
										className="flex h-full min-h-0 w-full flex-col"
										name={`expected-${flow.id}`}
										onChange={(value) => onFlowChange(flow.id, { expectedResult: value })}
										value={flow.expectedResult}
									>
										<Label className="mb-1.5 text-subheading text-on-surface">
											Expected result
										</Label>
										<TextArea
											className={`${fieldAreaClass} min-h-[8rem] flex-1`}
											placeholder="What should be true when this step succeeds…"
											rows={5}
										/>
									</TextField>
								</div>

								{canDeleteFlow ? (
									<button
										aria-label={`Delete step ${index + 1}`}
										className="flex size-9 shrink-0 items-center justify-center self-start rounded-lg text-on-surface-variant transition-colors hover:bg-error-container/50 hover:text-error"
										onClick={() => onRemoveFlow(flow.id)}
										title="Delete step"
										type="button"
									>
										<TrashIcon />
									</button>
								) : null}
							</li>
						);
					})}
				</ul>

				<div className="flex flex-wrap items-center gap-5 pl-14">
					<button className={actionLinkClass} onClick={onAddFlow} type="button">
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
	capabilities,
	onAdd,
	onChange,
	onRemove,
}: {
	capabilities: Capability[];
	onAdd: () => void;
	onChange: (id: string, patch: Partial<Pick<Capability, "key" | "value">>) => void;
	onRemove: (id: string) => void;
}) {
	return (
		<section className="w-full rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
			<div className="mb-5">
				<h2 className="mb-2 text-headline-md text-on-surface">Custom Appium Capabilities</h2>
				<p className="text-body-md text-on-surface-variant">
					Add custom Appium capabilities that will be passed to the driver when running this test.
					These override app-level capabilities.
				</p>
			</div>

			{capabilities.length > 0 ? (
				<ul className="mb-4 flex flex-col gap-3">
					{capabilities.map((cap) => (
						<li className="flex items-start gap-2" key={cap.id}>
							<TextField
								aria-label="Capability key"
								className="min-w-0 flex-1"
								name={`cap-key-${cap.id}`}
								onChange={(value) => onChange(cap.id, { key: value })}
								value={cap.key}
							>
								<Input className={fieldInputClass} placeholder="appium:autoLaunch" />
							</TextField>
							<TextField
								aria-label="Capability value"
								className="min-w-0 flex-1"
								name={`cap-value-${cap.id}`}
								onChange={(value) => onChange(cap.id, { value })}
								value={cap.value}
							>
								<Input className={fieldInputClass} placeholder="false" />
							</TextField>
							<Button
								aria-label="Remove capability"
								className="size-10 min-w-10 shrink-0 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
								onPress={() => onRemove(cap.id)}
								variant="ghost"
							>
								<TrashIcon />
							</Button>
						</li>
					))}
				</ul>
			) : null}

			<button
				className="inline-flex items-center gap-2 rounded-lg bg-surface-container px-4 py-2 text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high"
				onClick={onAdd}
				type="button"
			>
				<svg aria-hidden="true" className="size-[18px]" fill="currentColor" viewBox="0 0 20 20">
					<path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
				</svg>
				Add capability
			</button>
		</section>
	);
}

export function TestCaseDetailPage() {
	const { caseId } = useParams({ strict: false }) as { caseId?: string };
	const testCase = caseId ? getTestCase(caseId) : undefined;
	const [activeTab, setActiveTab] = useState<DetailTab>("instructions");
	const [form, setForm] = useState<FormState | null>(null);
	const [savedSnapshot, setSavedSnapshot] = useState<FormState | null>(null);

	useEffect(() => {
		if (!testCase) {
			setForm(null);
			setSavedSnapshot(null);
			return;
		}
		const next = formFromCase(testCase);
		setForm(next);
		setSavedSnapshot(next);
		setActiveTab("instructions");
	}, [testCase]);

	if (!testCase) {
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

	if (!form || !savedSnapshot) {
		return null;
	}

	const dirty = JSON.stringify(form) !== JSON.stringify(savedSnapshot);
	const canSave = dirty && form.name.trim().length > 0;
	const breadcrumbTitle = `#${testCase.number} ${form.name.trim() || testCase.name}`;

	const handleSave = () => {
		if (!canSave) return;
		const next: FormState = {
			...form,
			name: form.name.trim(),
			capabilities: form.capabilities
				.map((cap) => ({ ...cap, key: cap.key.trim(), value: cap.value.trim() }))
				.filter((cap) => cap.key.length > 0),
		};
		setForm(next);
		setSavedSnapshot(next);
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col gap-6">
			<header className="flex shrink-0 flex-wrap items-center justify-between gap-4">
				<nav className="flex min-w-0 items-center gap-2 text-body-md text-on-surface-variant">
					<Link className="shrink-0 transition-colors hover:text-on-surface" to="/test-cases">
						Test Cases
					</Link>
					<span aria-hidden="true">&gt;</span>
					<span className="truncate font-medium text-on-surface">{breadcrumbTitle}</span>
				</nav>

				<div className="flex items-center gap-1">
					<Button
						aria-label="Delete test case"
						className="size-10 min-w-10 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
						variant="ghost"
					>
						<TrashIcon />
					</Button>
					<Button
						aria-label="Duplicate test case"
						className="size-10 min-w-10 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-surface-container"
						variant="ghost"
					>
						<DuplicateIcon />
					</Button>
					<Button
						className="ml-1 rounded-lg bg-primary px-5 text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
						isDisabled={!canSave}
						onPress={handleSave}
					>
						Save
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
				{activeTab === "instructions" ? (
					<InstructionsPanel
						form={form}
						onAddFlow={() =>
							setForm((current) =>
								current
									? {
											...current,
											flows: [
												...current.flows,
												{
													id: `flow_${crypto.randomUUID()}`,
													instructions: "",
													expectedResult: "",
												},
											],
										}
									: current,
							)
						}
						onAddTag={(tag) =>
							setForm((current) => {
								if (!current) return current;
								const normalized = tag.toLowerCase();
								if (current.tags.some((existing) => existing.toLowerCase() === normalized)) {
									return current;
								}
								return { ...current, tags: [...current.tags, tag] };
							})
						}
						onFlowChange={(id, patch) =>
							setForm((current) =>
								current
									? {
											...current,
											flows: current.flows.map((flow) =>
												flow.id === id ? { ...flow, ...patch } : flow,
											),
										}
									: current,
							)
						}
						onMoveFlow={(fromIndex, toIndex) =>
							setForm((current) =>
								current
									? { ...current, flows: moveItem(current.flows, fromIndex, toIndex) }
									: current,
							)
						}
						onNameChange={(name) =>
							setForm((current) => (current ? { ...current, name } : current))
						}
						onRemoveFlow={(id) =>
							setForm((current) => {
								if (!current || current.flows.length <= 1) return current;
								return {
									...current,
									flows: current.flows.filter((flow) => flow.id !== id),
								};
							})
						}
						onRemoveTag={(tag) =>
							setForm((current) =>
								current
									? { ...current, tags: current.tags.filter((existing) => existing !== tag) }
									: current,
							)
						}
					/>
				) : (
					<ConfigurationPanel
						capabilities={form.capabilities}
						onAdd={() =>
							setForm((current) =>
								current
									? {
											...current,
											capabilities: [
												...current.capabilities,
												{ id: `cap_${crypto.randomUUID()}`, key: "", value: "" },
											],
										}
									: current,
							)
						}
						onChange={(id, patch) =>
							setForm((current) =>
								current
									? {
											...current,
											capabilities: current.capabilities.map((cap) =>
												cap.id === id ? { ...cap, ...patch } : cap,
											),
										}
									: current,
							)
						}
						onRemove={(id) =>
							setForm((current) =>
								current
									? {
											...current,
											capabilities: current.capabilities.filter((cap) => cap.id !== id),
										}
									: current,
							)
						}
					/>
				)}
			</div>
		</div>
	);
}
