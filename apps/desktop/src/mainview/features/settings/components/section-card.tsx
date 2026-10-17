import type { ReactNode } from "react";

export function SectionCard({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
			{children}
		</div>
	);
}
