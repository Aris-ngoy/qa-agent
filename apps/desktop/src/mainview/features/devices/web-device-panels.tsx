import { RhfTextField } from "@/app/forms";
import { Button, Form } from "@heroui/react";
import {
	VIEWPORT_PRESETS,
	VIEWPORT_PRESET_NAMES,
	type ViewportPresetName,
} from "@yoqa/runner-client";
import { useForm } from "react-hook-form";
import { attachDeviceId } from "./web-device";

const PRESET_LABELS: Record<ViewportPresetName, string> = {
	desktop: "Desktop",
	mobile: "Mobile",
};

/** The Viewport preset a browser connects at, fixed for the Device Session's life. */
export function ViewportChoice({
	value,
	onChange,
}: {
	value: ViewportPresetName;
	onChange: (preset: ViewportPresetName) => void;
}) {
	return (
		<fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
			<legend className="mb-2 text-body-md font-semibold text-on-surface">Viewport</legend>
			<div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-container p-1">
				{VIEWPORT_PRESET_NAMES.map((name) => {
					const { width, height, mobile } = VIEWPORT_PRESETS[name];
					const selected = name === value;
					return (
						<button
							aria-pressed={selected}
							className={[
								"flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 text-body-sm font-medium transition-colors",
								selected
									? "bg-surface-container-lowest text-on-surface shadow-card"
									: "text-on-surface-variant hover:text-on-surface",
							].join(" ")}
							key={name}
							onClick={() => onChange(name)}
							type="button"
						>
							<span>{PRESET_LABELS[name]}</span>
							<span className="text-helper text-on-surface-variant">
								{width}×{height}
								{mobile ? " · touch" : ""}
							</span>
						</button>
					);
				})}
			</div>
			<p className="m-0 text-helper text-on-surface-variant">
				The page keeps this size for the whole session, so runs stay comparable.
			</p>
		</fieldset>
	);
}

type AttachForm = { port: string };

const inputClass =
	"w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-2.5 font-mono text-body-md text-on-surface shadow-none placeholder:text-on-surface-variant/65 focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/10";

/** Attach to a Chromium the user started, named by its debug port. Ports are never scanned. */
export function AttachByPortForm({
	checklist,
	onAttach,
}: {
	checklist: string[];
	onAttach: (deviceId: string) => void;
}) {
	const {
		control,
		handleSubmit,
		formState: { isValid },
	} = useForm<AttachForm>({ defaultValues: { port: "9222" }, mode: "onChange" });

	const onSubmit = (values: AttachForm) => {
		const deviceId = attachDeviceId(values.port);
		if (deviceId) onAttach(deviceId);
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="rounded-xl border border-outline-variant bg-surface-container-low/60 px-4 py-3.5">
				<p className="mb-2 text-body-md font-semibold text-on-surface">
					Start the browser yourself, with:
				</p>
				<ul className="list-disc space-y-1 pl-5 text-body-sm text-on-surface">
					{checklist.map((item) => (
						<li key={item}>{item}</li>
					))}
				</ul>
			</div>
			<Form className="flex items-start gap-2" onSubmit={handleSubmit(onSubmit)}>
				<RhfTextField
					aria-label="Debug port"
					className="w-full"
					control={control}
					description="Yoqa attaches on localhost and never closes this browser."
					inputClassName={inputClass}
					name="port"
					placeholder="9222"
					rules={{
						validate: (value) =>
							(typeof value === "string" && attachDeviceId(value) != null) ||
							"Enter a port from 1 to 65535",
					}}
				/>
				<Button
					className="h-[42px] shrink-0 rounded-xl bg-primary px-4 text-on-primary data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
					isDisabled={!isValid}
					type="submit"
				>
					Attach
				</Button>
			</Form>
		</div>
	);
}
