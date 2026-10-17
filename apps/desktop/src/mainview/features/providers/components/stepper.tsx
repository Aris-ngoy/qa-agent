import {
	type HTMLAttributes,
	type OlHTMLAttributes,
	type ReactNode,
	createContext,
	isValidElement,
	useContext,
	useMemo,
} from "react";

type StepStatus = "inactive" | "active" | "complete";

type StepperContextValue = {
	orientation: "horizontal" | "vertical";
	size: "sm" | "md" | "lg";
	currentStep: number;
	onStepChange?: (step: number) => void;
	stepCount: number;
};

type StepContextValue = {
	index: number;
	status: StepStatus;
	isLast: boolean;
};

const StepperContext = createContext<StepperContextValue | null>(null);
const StepContext = createContext<StepContextValue | null>(null);

function useStepperContext(): StepperContextValue {
	const ctx = useContext(StepperContext);
	if (!ctx) throw new Error("Stepper components must be used within <Stepper>");
	return ctx;
}

export function useStepperStep(): StepContextValue {
	const ctx = useContext(StepContext);
	if (!ctx) throw new Error("useStepperStep must be used within <Stepper.Step>");
	return ctx;
}

function sizeVars(size: "sm" | "md" | "lg"): string {
	switch (size) {
		case "sm":
			return "[--stepper-indicator-size:1.375rem] [--stepper-vertical-gap:0.75rem]";
		case "lg":
			return "[--stepper-indicator-size:2.25rem] [--stepper-vertical-gap:1.5rem]";
		default:
			return "[--stepper-indicator-size:1.75rem] [--stepper-vertical-gap:1rem]";
	}
}

type StepperProps = OlHTMLAttributes<HTMLOListElement> & {
	orientation?: "horizontal" | "vertical";
	size?: "sm" | "md" | "lg";
	currentStep?: number;
	defaultStep?: number;
	onStepChange?: (step: number) => void;
	children: ReactNode;
};

function StepperRoot({
	orientation = "horizontal",
	size = "md",
	currentStep = 0,
	onStepChange,
	className,
	children,
	...rest
}: StepperProps) {
	const childArray = useMemo(
		() => (Array.isArray(children) ? children : [children]).filter(Boolean),
		[children],
	);
	const stepCount = childArray.length;

	const value = useMemo<StepperContextValue>(
		() => ({
			orientation,
			size,
			currentStep,
			onStepChange,
			stepCount,
		}),
		[orientation, size, currentStep, onStepChange, stepCount],
	);

	return (
		<StepperContext.Provider value={value}>
			<ol
				aria-label="Progress"
				className={[
					"stepper flex w-full list-none p-0",
					orientation === "horizontal" ? "flex-row items-start" : "flex-col",
					sizeVars(size),
					className ?? "",
				].join(" ")}
				{...rest}
			>
				{childArray.map((child, index) => {
					const status: StepStatus =
						index < currentStep ? "complete" : index === currentStep ? "active" : "inactive";
					const childKey =
						isValidElement(child) && child.key != null ? String(child.key) : `step-${index}`;
					return (
						<StepContext.Provider
							key={childKey}
							value={{
								index,
								status,
								isLast: index === stepCount - 1,
							}}
						>
							{child}
						</StepContext.Provider>
					);
				})}
			</ol>
		</StepperContext.Provider>
	);
}

function Step({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLLIElement> & { children: ReactNode }) {
	const { orientation } = useStepperContext();
	const { status } = useStepperStep();

	return (
		<li
			className={[
				"stepper__step relative flex min-w-0",
				orientation === "horizontal"
					? "flex-1 flex-col items-stretch"
					: "w-full flex-row items-start gap-3",
				className ?? "",
			].join(" ")}
			data-status={status}
			{...rest}
		>
			{children}
		</li>
	);
}

function StepButton({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
	const { orientation, onStepChange } = useStepperContext();
	const { index, status } = useStepperStep();
	const clickable = Boolean(onStepChange) && status === "complete";

	return (
		<button
			className={[
				"stepper__step-button flex min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
				orientation === "horizontal"
					? "w-full flex-col items-stretch gap-2"
					: "flex-row items-start gap-2",
				clickable ? "cursor-pointer" : "cursor-default",
				className ?? "",
			].join(" ")}
			data-clickable={clickable ? "true" : "false"}
			disabled={!clickable}
			type="button"
			onClick={() => {
				if (clickable) onStepChange?.(index);
			}}
			{...rest}
		>
			{children}
		</button>
	);
}

function Indicator({
	className,
	children,
}: {
	className?: string;
	children?: ReactNode;
}) {
	const { size } = useStepperContext();
	const { index, status } = useStepperStep();

	const textSize = size === "sm" ? "text-[10px]" : size === "lg" ? "text-body-sm" : "text-helper";

	return (
		<span
			aria-hidden
			className={[
				"stepper__indicator inline-flex shrink-0 items-center justify-center rounded-full border font-semibold transition-colors",
				"size-[var(--stepper-indicator-size)]",
				textSize,
				status === "active"
					? "border-primary bg-primary text-on-primary"
					: status === "complete"
						? "border-primary bg-primary text-on-primary"
						: "border-outline-variant bg-transparent text-on-surface-variant",
				className ?? "",
			].join(" ")}
			data-status={status}
		>
			{children ??
				(status === "complete" ? (
					<svg
						aria-hidden
						className="size-3.5"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth="2.5"
					>
						<title>Complete</title>
						<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				) : (
					index + 1
				))}
		</span>
	);
}

function Content({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
	const { orientation } = useStepperContext();
	return (
		<span
			className={[
				"stepper__content flex min-w-0 flex-col",
				orientation === "horizontal" ? "" : "pt-0.5",
				className ?? "",
			].join(" ")}
			{...rest}
		>
			{children}
		</span>
	);
}

function Title({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
	const { status } = useStepperStep();
	return (
		<span
			className={[
				"stepper__title text-body-sm font-semibold",
				status === "inactive" ? "text-on-surface-variant" : "text-on-surface",
				status === "active" ? "text-primary" : "",
				className ?? "",
			].join(" ")}
			{...rest}
		>
			{children}
		</span>
	);
}

function Description({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
	return (
		<span
			className={["stepper__description text-helper text-on-surface-variant", className ?? ""].join(
				" ",
			)}
			{...rest}
		>
			{children}
		</span>
	);
}

function Icon({
	className,
	children,
	...rest
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode }) {
	return (
		<span className={["stepper__icon inline-flex", className ?? ""].join(" ")} {...rest}>
			{children}
		</span>
	);
}

function Separator({
	className,
	progress,
	force = false,
	...rest
}: HTMLAttributes<HTMLDivElement> & { progress?: number; force?: boolean }) {
	const { orientation, currentStep } = useStepperContext();
	const { index, isLast, status } = useStepperStep();
	if (isLast && !force) return null;

	const fill =
		progress ??
		(status === "complete" || index < currentStep ? 1 : index === currentStep ? 0.35 : 0);

	if (orientation === "vertical") {
		return (
			<div
				aria-hidden
				className={[
					"stepper__separator absolute top-[var(--stepper-indicator-size)] bottom-0 left-[calc(var(--stepper-indicator-size)/2)] w-0.5 -translate-x-1/2",
					className ?? "",
				].join(" ")}
				{...rest}
			>
				<div className="stepper__separator-track relative h-full w-full overflow-hidden bg-outline-variant">
					<div
						className="stepper__separator-fill absolute inset-x-0 top-0 bg-primary transition-[height] duration-300"
						data-complete={fill >= 1 ? "" : undefined}
						style={{ height: `${Math.max(0, Math.min(1, fill)) * 100}%` }}
					/>
				</div>
			</div>
		);
	}

	return (
		<div
			aria-hidden
			className={[
				"stepper__separator mx-2 flex h-[var(--stepper-indicator-size)] min-w-0 flex-1 items-center",
				className ?? "",
			].join(" ")}
			{...rest}
		>
			<div className="stepper__separator-track relative h-0.5 w-full overflow-hidden rounded-full bg-outline-variant">
				<div
					className="stepper__separator-fill absolute inset-y-0 left-0 bg-primary transition-[width] duration-300"
					data-complete={fill >= 1 ? "" : undefined}
					style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }}
				/>
			</div>
		</div>
	);
}

export const Stepper = Object.assign(StepperRoot, {
	Step,
	StepButton,
	Indicator,
	Content,
	Title,
	Description,
	Icon,
	Separator,
});
