import { Switch } from "@heroui/react";
import type { AiProvider, ProviderModel } from "@yoqa/runner-client";
import { DriverGlyph, statusDotClass, useDriverMeta } from "./driver-meta";
import { ProviderExpanded } from "./provider-expanded";

type ProviderRowProps = {
	provider: AiProvider;
	expanded: boolean;
	models: ProviderModel[];
	modelsMessage: string;
	modelsLoading: boolean;
	busy: boolean;
	onToggleExpand: () => void;
	onToggleEnabled: (enabled: boolean) => Promise<void>;
	onSave: Parameters<typeof ProviderExpanded>[0]["onSave"];
	onDisconnect: () => Promise<void>;
	onSetDefault: () => Promise<void>;
};

export function ProviderRow({
	provider,
	expanded,
	models,
	modelsMessage,
	modelsLoading,
	busy,
	onToggleExpand,
	onToggleEnabled,
	onSave,
	onDisconnect,
	onSetDefault,
}: ProviderRowProps) {
	const meta = useDriverMeta(provider.kind);
	const detail =
		provider.statusDetail ||
		(provider.status === "connected"
			? "Authenticated"
			: provider.status === "disabled"
				? "Disabled in Yoqa settings"
				: provider.status === "not_found"
					? "Not found"
					: provider.status === "invalid"
						? "Invalid credentials"
						: "Not checked");

	return (
		<div className="rounded-xl border border-outline-variant bg-surface-container-low/30">
			<div className="flex items-center gap-3 px-4 py-3">
				<button
					className="flex min-w-0 flex-1 items-center gap-3 text-left"
					type="button"
					onClick={onToggleExpand}
				>
					<span className="relative shrink-0">
						<DriverGlyph kind={provider.kind} />
						<span
							className={[
								"absolute -top-0.5 -left-0.5 size-2.5 rounded-full ring-2 ring-surface",
								statusDotClass(provider.status),
							].join(" ")}
						/>
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<p className="truncate text-body-md font-semibold text-on-surface">
								{provider.label}
							</p>
							{meta.earlyAccess ? (
								<span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
									Early Access
								</span>
							) : null}
							{provider.isDefault ? (
								<span className="rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
									Default
								</span>
							) : null}
						</div>
						<p className="mt-0.5 truncate text-body-sm text-on-surface-variant">{detail}</p>
					</div>
					<span
						aria-hidden
						className={[
							"text-on-surface-variant transition-transform",
							expanded ? "rotate-180" : "",
						].join(" ")}
					>
						▾
					</span>
				</button>
				<Switch
					isSelected={provider.enabled}
					isDisabled={busy}
					onChange={(next) => void onToggleEnabled(next)}
					size="sm"
					aria-label={provider.enabled ? "Disable provider" : "Enable provider"}
				/>
			</div>

			{expanded ? (
				<ProviderExpanded
					busy={busy}
					models={models}
					modelsLoading={modelsLoading}
					modelsMessage={modelsMessage}
					provider={provider}
					onDisconnect={onDisconnect}
					onSave={onSave}
					onSetDefault={onSetDefault}
				/>
			) : null}
		</div>
	);
}
