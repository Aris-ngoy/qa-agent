import { ProviderLogo } from "@/features/providers/components/provider-logo";
import type { ReactNode } from "react";

export function DriverGlyph({ kind }: { kind: string }): ReactNode {
	const logo = <ProviderLogo kind={kind} />;

	return (
		<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface">
			{logo}
		</span>
	);
}
