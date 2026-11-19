import { openExternalUrl } from "@/app/desktop-rpc";
import { yoqaUpdate$ } from "@/features/yoqa-update/data/state/yoqa-update";
import { useRestartForYoqaUpdate } from "@/features/yoqa-update/hooks/usequery/use-yoqa-update";
import {
	readyPromptText,
	releasePageUrl,
	restartHeldText,
} from "@/features/yoqa-update/utils/yoqa-update-copy";
import { Button, Spinner } from "@heroui/react";
import { useValue } from "@legendapp/state/react";

/** "Yoqa vX is ready — Restart", shown above every page while a Yoqa update is ready. */
export function YoqaUpdateBanner() {
	const state = useValue(yoqaUpdate$.state);
	const version = useValue(yoqaUpdate$.version);
	const restartHeld = useValue(yoqaUpdate$.restartHeld);
	const restartMutation = useRestartForYoqaUpdate();

	if (state !== "ready" || !version) return null;
	const whatsNew = releasePageUrl(version);
	const heldReason = restartHeldText(restartHeld);

	return (
		<output
			aria-live="polite"
			className="motion-fade-up flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-secondary-container px-4 py-2.5 text-on-secondary-container shadow-card"
		>
			<p className="text-body-md">
				<span className="font-semibold">{readyPromptText(version)}</span>
				<a
					className="ml-3 text-body-sm font-medium underline-offset-2 hover:underline"
					href={whatsNew}
					onClick={(event) => {
						event.preventDefault();
						void openExternalUrl(whatsNew);
					}}
					rel="noreferrer"
				>
					What's new
				</a>
			</p>
			<div className="flex items-center gap-3">
				{heldReason ? <span className="text-body-sm">{heldReason}</span> : null}
				<Button
					isDisabled={restartHeld || restartMutation.isPending}
					onPress={() => restartMutation.mutate()}
					size="sm"
					variant="primary"
				>
					{restartMutation.isPending ? (
						<>
							<Spinner aria-label="Restarting" color="current" size="sm" />
							Restarting…
						</>
					) : (
						"Restart"
					)}
				</Button>
			</div>
		</output>
	);
}
