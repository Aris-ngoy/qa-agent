import { type RunListTone, runListResult } from "@/features/runs/utils/labels";
import type { Run } from "@yoqa/runner-client";

const STATUS_PILL: Record<RunListTone, string> = {
	passed: "bg-secondary/12 text-on-secondary-container",
	failed: "bg-error/12 text-on-error-container",
	empty: "bg-on-surface/5 text-on-surface-variant",
	cancelled: "bg-on-surface/5 text-on-surface-variant",
	live: "bg-violet-container text-on-violet-container",
};

const STATUS_DOT: Record<RunListTone, string> = {
	passed: "bg-secondary",
	failed: "bg-error",
	empty: "bg-outline",
	cancelled: "bg-outline",
	live: "bg-violet motion-live-dot",
};

export function RunStatusPill({ run }: { run: Run }) {
	const result = runListResult(run);
	return (
		<span
			className={[
				"inline-flex h-[22px] items-center gap-1.5 rounded-md px-2 text-xs font-medium",
				STATUS_PILL[result.tone],
			].join(" ")}
		>
			<span className={["size-1.5 rounded-full", STATUS_DOT[result.tone]].join(" ")} />
			{result.label}
		</span>
	);
}
