import { ListBox, Select } from "@heroui/react";
import type { ReactNode } from "react";
import {
	type Control,
	Controller,
	type FieldPath,
	type FieldValues,
	type RegisterOptions,
} from "react-hook-form";

export type RhfSelectOption = {
	id: string;
	label: string;
};

type RhfSelectFieldProps<TFieldValues extends FieldValues> = {
	control: Control<TFieldValues>;
	name: FieldPath<TFieldValues>;
	options: readonly RhfSelectOption[];
	ariaLabel: string;
	placeholder?: string;
	triggerClassName?: string;
	rules?: RegisterOptions<TFieldValues, FieldPath<TFieldValues>>;
	/** When true, clears the field to null when selection is cleared. */
	nullable?: boolean;
	description?: ReactNode;
};

export function RhfSelectField<TFieldValues extends FieldValues>({
	control,
	name,
	options,
	ariaLabel,
	placeholder = "Select…",
	triggerClassName = "h-11 w-full items-center rounded-xl border border-on-surface/80 bg-surface-container-lowest px-3.5 shadow-none",
	rules,
	nullable = false,
	description,
}: RhfSelectFieldProps<TFieldValues>) {
	return (
		<Controller
			control={control}
			name={name}
			rules={rules}
			render={({ field }) => (
				<div>
					{description ? (
						<div className="mb-4 text-body-md text-on-surface-variant">{description}</div>
					) : null}
					<Select
						aria-label={ariaLabel}
						placeholder={placeholder}
						selectedKey={field.value ?? null}
						onSelectionChange={(key) => {
							if (key == null) {
								field.onChange(nullable ? null : "");
								return;
							}
							field.onChange(String(key));
						}}
					>
						<Select.Trigger className={triggerClassName}>
							<Select.Value />
							<Select.Indicator className="text-on-surface-variant" />
						</Select.Trigger>
						<Select.Popover>
							<ListBox>
								{options.map((item) => (
									<ListBox.Item id={item.id} key={item.id} textValue={item.label}>
										{item.label}
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>
				</div>
			)}
		/>
	);
}
