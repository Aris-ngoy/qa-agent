import { Description, Input, TextField } from "@heroui/react";

/**
 * The iOS "Runner Signing (removed)" section, shared by the settings page and
 * the settings modal twins. Argent manages its own runner since the backend
 * cutover, so the team-id / runner-bundle-id fields are legacy-only (kept
 * readable for now, marked for removal).
 *
 * Callers supply their own wrapper (the page uses a SectionCard, the modal a
 * bare `<section>`) so each keeps its existing layout.
 */
type RunnerSigningRemovedProps = {
	teamId: string | null;
	bundleId: string;
	onBundleChange: (value: string) => void;
	onBundleBlur: () => void;
	onBundleFocus: () => void;
	/** Input surface class differs slightly between the two twins. */
	inputSurfaceClass: string;
};

export function RunnerSigningRemoved({
	teamId,
	bundleId,
	onBundleChange,
	onBundleBlur,
	onBundleFocus,
	inputSurfaceClass,
}: RunnerSigningRemovedProps) {
	return (
		<>
			<h3 className="text-subheading font-semibold text-on-surface">Runner Signing (removed)</h3>
			<p className="mt-1 mb-3 text-body-md text-on-surface-variant">
				Argent manages its own runner since the backend cutover, so these signing settings are no
				longer used and will be removed.
			</p>
			<p className="mb-3 text-body-md text-on-surface-variant">
				Team ID:{" "}
				<span className="font-mono text-body-sm text-on-surface">
					{teamId ?? "select a signing identity above"}
				</span>
			</p>
			<TextField
				aria-label="Runner bundle id"
				className="w-full"
				onChange={onBundleChange}
				value={bundleId}
			>
				<Input
					className={`h-12 w-full rounded-xl border border-outline-variant ${inputSurfaceClass} px-3.5 font-mono text-body-sm shadow-none`}
					onBlur={onBundleBlur}
					onFocus={onBundleFocus}
					placeholder="com.yourname.agentdevice.runner"
				/>
				<Description className="mt-1.5 text-helper text-on-surface-variant">
					No longer used — Argent manages its own runner.
				</Description>
			</TextField>
		</>
	);
}
