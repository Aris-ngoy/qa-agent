import type { ReactNode } from "react";

type StatusBadgeProps = {
	label: string;
	tone?: "ok" | "warn" | "neutral";
	children?: ReactNode;
};

const toneClass: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
	ok: "text-secondary",
	warn: "text-warning",
	neutral: "text-on-surface-variant",
};

export function StatusBadge({ label, tone = "neutral", children }: StatusBadgeProps) {
	return (
		<span className={`inline-flex items-center gap-2 text-body-sm ${toneClass[tone]}`}>
			<span className="font-medium">{label}</span>
			{children}
		</span>
	);
}
