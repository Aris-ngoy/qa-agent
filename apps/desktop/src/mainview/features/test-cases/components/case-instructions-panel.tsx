import { openExternalUrl } from "@/app/desktop-rpc";
import { RhfTextField, requiredTrimmed } from "@/app/forms";
import { GripIcon, Icon, TrashIcon } from "@/features/test-cases/components/case-icons";
import type { FormValues } from "@/features/test-cases/utils/case-form";
import {
	actionLinkClass,
	fieldAreaClass,
	fieldInputClass,
} from "@/features/test-cases/utils/case-styles";
import { useObservable, useValue } from "@legendapp/state/react";
import { type Control, type UseFormSetValue, useFieldArray, useWatch } from "react-hook-form";

export function CaseInstructionsPanel({
	control,
	setValue,
}: {
	control: Control<FormValues>;
	setValue: UseFormSetValue<FormValues>;
}) {
	const tagDraft$ = useObservable("");
	const draggingIndex$ = useObservable<number | null>(null);
	const tagDraft = useValue(tagDraft$);
	const draggingIndex = useValue(draggingIndex$);
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
			tagDraft$.set("");
			return;
		}
		setValue("tags", [...tags, next], { shouldDirty: true });
		tagDraft$.set("");
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
								onChange={(event) => tagDraft$.set(event.target.value)}
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
										draggingIndex$.set(index);
									}}
									onDrop={(event) => {
										event.preventDefault();
										draggingIndex$.set(null);
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
										onDragEnd={() => draggingIndex$.set(null)}
										onDragStart={(event) => {
											event.dataTransfer.effectAllowed = "move";
											event.dataTransfer.setData("text/plain", String(index));
											if (event.currentTarget.parentElement) {
												event.dataTransfer.setDragImage(event.currentTarget.parentElement, 24, 24);
											}
											draggingIndex$.set(index);
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

			<aside className="h-fit rounded-2xl bg-warning-container p-5 xl:sticky xl:top-2">
				<div className="mb-3 flex size-8 items-center justify-center rounded-full bg-warning/30 text-on-warning-container">
					<svg aria-hidden="true" className="size-4" fill="currentColor" viewBox="0 0 24 24">
						<path d="M9 21h6v-1.5H9V21zm3-19a6 6 0 00-3.5 10.9c.6.4 1 1 1.1 1.7V17h4.8v-2.4c.1-.7.5-1.3 1.1-1.7A6 6 0 0012 2z" />
					</svg>
				</div>
				<p className="mb-4 text-body-sm leading-relaxed text-on-surface">
					Learn how to write effective test cases that produce reliable, reproducible results.
				</p>
				<a
					className="inline-flex items-center gap-1.5 text-body-sm font-medium text-on-surface underline-offset-2 hover:underline"
					href="https://yoqa.arisn.dev/guide/writing-test-cases"
					onClick={(event) => {
						event.preventDefault();
						void openExternalUrl("https://yoqa.arisn.dev/guide/writing-test-cases");
					}}
					rel="noreferrer"
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
