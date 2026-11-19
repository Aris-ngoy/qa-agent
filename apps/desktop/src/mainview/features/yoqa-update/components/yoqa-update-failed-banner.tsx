import { YoqaUpdateBannerShell } from "@/features/yoqa-update/components/yoqa-update-banner-shell";
import { failedPromptText, releasePageUrl } from "@/features/yoqa-update/utils/yoqa-update-copy";

/**
 * Shown in place of the ready banner after a Yoqa update failed to apply: the old version still
 * runs, and the release page offers that version to download by hand.
 */
export function YoqaUpdateFailedBanner({ version }: { version: string }) {
	return (
		<YoqaUpdateBannerShell
			headline={failedPromptText(version)}
			link={{ href: releasePageUrl(version), label: `Download v${version} by hand` }}
			tone="failed"
		/>
	);
}
