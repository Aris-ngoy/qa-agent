import { RhfSelectField } from "@/app/forms";
import { type FormValues, LOCALES } from "@/features/test-cases/utils/case-form";
import { configCardClass, softButtonClass } from "@/features/test-cases/utils/case-styles";
import { Switch } from "@heroui/react";
import { useRef } from "react";
import { type Control, Controller, type UseFormSetValue, useWatch } from "react-hook-form";

export function CaseConfigurationPanel({
	control,
	setValue,
}: {
	control: Control<FormValues>;
	setValue: UseFormSetValue<FormValues>;
}) {
	const fileInputRef = useRef<HTMLInputElement>(null);
	const galleryImages = useWatch({ control, name: "galleryImages" }) ?? [];

	return (
		<div className="flex w-full max-w-2xl flex-col gap-5">
			<section className={configCardClass}>
				<Controller
					control={control}
					name="recordVideo"
					render={({ field }) => (
						<Switch className="w-full" isSelected={field.value} onChange={field.onChange}>
							{/* Switch.Content is the clickable button: the control must live inside it. */}
							<Switch.Content className="flex w-full items-center justify-between gap-4 text-left">
								<span className="flex flex-col gap-1.5">
									<span className="text-headline-md text-on-surface">Record video</span>
									<span className="text-body-md text-on-surface-variant">
										Record the screen whenever this test case runs. The video appears on the run
										once it has finished.
									</span>
								</span>
								<Switch.Control>
									<Switch.Thumb />
								</Switch.Control>
							</Switch.Content>
						</Switch>
					)}
				/>
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
