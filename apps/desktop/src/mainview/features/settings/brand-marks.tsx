import type { SigningTier } from "../../../shared/ios-toolchain";

/** Xcode's blue is a third-party brand color, the same in every theme. */
export function XcodeMark() {
	return (
		<span
			aria-hidden="true"
			className="flex size-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-[#147EFB] to-[#0A84FF] text-[10px] font-bold text-white"
		>
			X
		</span>
	);
}

export function TierBadge({ tier }: { tier: SigningTier }) {
	return (
		<span
			className={[
				"shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
				tier === "Paid"
					? "bg-[#147EFB] text-white"
					: "bg-surface-container-high text-on-surface-variant",
			].join(" ")}
		>
			{tier}
		</span>
	);
}
