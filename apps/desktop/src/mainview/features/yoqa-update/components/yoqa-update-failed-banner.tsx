import { openExternalUrl } from "@/app/desktop-rpc";
import { failedPromptText, releasePageUrl } from "@/features/yoqa-update/utils/yoqa-update-copy";

/**
 * Shown in place of the ready banner after a Yoqa update failed to apply: the old version still
 * runs, and the release page offers that version to download by hand.
 */
export function YoqaUpdateFailedBanner({ version }: { version: string }) {
	const releasePage = releasePageUrl(version);

	return (
		<output
			aria-live="polite"
			className="motion-fade-up flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-error-container px-4 py-2.5 text-on-error-container shadow-card"
		>
			<p className="text-body-md">
				<span className="font-semibold">{failedPromptText(version)}</span>
				<a
					className="ml-3 text-body-sm font-medium underline-offset-2 hover:underline"
					href={releasePage}
					onClick={(event) => {
						event.preventDefault();
						void openExternalUrl(releasePage);
					}}
					rel="noreferrer"
				>
					Download v{version} by hand
				</a>
			</p>
		</output>
	);
}
