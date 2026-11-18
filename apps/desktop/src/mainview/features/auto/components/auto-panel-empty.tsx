import type { ReactNode } from "react";

/** What a tab of Auto's right panel shows while it has nothing to show. */
export function PanelEmpty({ title, children }: { title: string; children: ReactNode }) {
	return (
		<div className="flex h-full min-h-56 flex-col items-center justify-center gap-2 rounded-xl bg-surface-container px-6 text-center">
			<p className="m-0 text-body-sm font-medium text-on-surface">{title}</p>
			<p className="m-0 max-w-xs text-helper text-on-surface-variant">{children}</p>
		</div>
	);
}
