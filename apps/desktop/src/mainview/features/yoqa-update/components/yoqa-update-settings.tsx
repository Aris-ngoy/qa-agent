import { SectionCard } from "@/features/settings/components/section-card";
import { yoqaUpdate$ } from "@/features/yoqa-update/data/state/yoqa-update";
import {
	useCheckForYoqaUpdate,
	useYoqaVersion,
} from "@/features/yoqa-update/hooks/usequery/use-yoqa-update";
import { lastCheckedText, updateStatusText } from "@/features/yoqa-update/utils/yoqa-update-copy";
import { Button, Spinner } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { useEffect } from "react";

/** Re-read the clock every 30 seconds so "Last checked 5 minutes ago" stays true. */
function useNow(): number {
	const now$ = useObservable(() => Date.now());
	useEffect(() => {
		const id = setInterval(() => now$.set(Date.now()), 30_000);
		return () => clearInterval(id);
	}, [now$]);
	return useValue(now$);
}

/** Settings › Updates: the installed version, the last check, and "Check for updates". */
export function YoqaUpdateSettings() {
	const status = useValue(yoqaUpdate$);
	const versionQuery = useYoqaVersion();
	const checkMutation = useCheckForYoqaUpdate();
	const now = useNow();

	const channel = versionQuery.data?.channel ?? "";
	const busy = status.state === "checking" || status.state === "downloading";
	const canCheck = Boolean(versionQuery.data) && channel !== "dev" && !busy;

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body-md text-on-surface-variant">
				Yoqa checks GitHub Releases for a newer version when it launches and downloads it in the
				background. It only installs when you choose Restart.
			</p>

			<SectionCard>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h3 className="text-subheading font-semibold text-on-surface">Yoqa updates</h3>
						<p className="mt-1 text-body-sm text-on-surface-variant">
							{versionQuery.data ? `Version ${versionQuery.data.version}` : "Version unknown"}
						</p>
						<p className="mt-3 text-body-md font-medium text-on-surface">
							{updateStatusText(status, channel)}
						</p>
						{channel !== "dev" ? (
							<p className="mt-1 text-body-sm text-on-surface-variant">
								{lastCheckedText(status.lastCheckedAt, now)}
							</p>
						) : null}
						{status.lastError ? (
							<p className="mt-2 text-body-sm text-error">{status.lastError}</p>
						) : null}
						{checkMutation.isError ? (
							<p className="mt-2 text-body-sm text-error">
								Could not reach the Yoqa host to check for updates.
							</p>
						) : null}
					</div>
					<Button
						isDisabled={!canCheck || checkMutation.isPending}
						onPress={() => checkMutation.mutate()}
						variant="secondary"
					>
						{busy ? (
							<>
								<Spinner aria-label="Checking for updates" color="current" size="sm" />
								{status.state === "downloading" ? "Downloading…" : "Checking…"}
							</>
						) : (
							"Check for updates"
						)}
					</Button>
				</div>
			</SectionCard>
		</div>
	);
}
