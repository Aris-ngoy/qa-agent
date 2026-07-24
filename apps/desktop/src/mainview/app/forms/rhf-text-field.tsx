import { Description, FieldError, Input, Label, TextArea, TextField } from "@heroui/react";
import type { ReactNode } from "react";
import {
	type Control,
	Controller,
	type FieldPath,
	type FieldValues,
	type RegisterOptions,
} from "react-hook-form";

type RhfTextFieldProps<TFieldValues extends FieldValues> = {
	control: Control<TFieldValues>;
	name: FieldPath<TFieldValues>;
	label?: ReactNode;
	description?: ReactNode;
	placeholder?: string;
	className?: string;
	inputClassName?: string;
	rules?: RegisterOptions<TFieldValues, FieldPath<TFieldValues>>;
	multiline?: boolean;
	rows?: number;
	autoFocus?: boolean;
	type?: "text" | "password" | "email" | "url";
	"aria-label"?: string;
	onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
};

export function RhfTextField<TFieldValues extends FieldValues>({
	control,
	name,
	label,
	description,
	placeholder,
	className = "w-full",
	inputClassName,
	rules,
	multiline = false,
	rows = 3,
	autoFocus,
	type = "text",
	"aria-label": ariaLabel,
	onKeyDown,
}: RhfTextFieldProps<TFieldValues>) {
	return (
		<Controller
			control={control}
			name={name}
			rules={rules}
			render={({ field, fieldState }) => (
				<TextField
					aria-label={ariaLabel}
					className={className}
					isInvalid={fieldState.invalid}
					name={field.name}
					onChange={field.onChange}
					value={field.value ?? ""}
				>
					{label ? <Label className="mb-1.5 text-subheading text-on-surface">{label}</Label> : null}
					{multiline ? (
						<TextArea
							className={inputClassName}
							onBlur={field.onBlur}
							placeholder={placeholder}
							ref={field.ref}
							rows={rows}
						/>
					) : (
						<Input
							autoFocus={autoFocus}
							autoComplete={type === "password" ? "off" : undefined}
							className={inputClassName}
							onBlur={field.onBlur}
							onKeyDown={onKeyDown}
							placeholder={placeholder}
							ref={field.ref}
							type={type}
						/>
					)}
					{description && !fieldState.invalid ? (
						<Description className="mt-1.5 text-helper text-on-surface-variant">
							{description}
						</Description>
					) : null}
					{fieldState.error?.message ? <FieldError>{fieldState.error.message}</FieldError> : null}
				</TextField>
			)}
		/>
	);
}

/** Shared required-name rule used across create/edit forms. */
export function requiredTrimmed(
	message = "Name is required",
): Pick<RegisterOptions, "required" | "validate"> {
	return {
		required: message,
		validate: (value) => (typeof value === "string" && value.trim().length > 0) || message,
	};
}
