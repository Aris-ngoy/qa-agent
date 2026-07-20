import type { ReactNode } from "react";

type StatusBadgeProps = {
	label: string;
	tone?: "ok" | "warn" | "neutral";
	children?: ReactNode;
};

const toneClass: Record<NonNullable<StatusBadgeProps["tone"]>, string> = {
	ok: "text-qa-accent",
	warn: "text-amber-700",
	neutral: "text-qa-ink/70",
};

export function StatusBadge({ label, tone = "neutral", children }: StatusBadgeProps) {
	return (
		<span className={`inline-flex items-center gap-2 text-sm ${toneClass[tone]}`}>
			<span className="font-medium">{label}</span>
			{children}
		</span>
	);
}
