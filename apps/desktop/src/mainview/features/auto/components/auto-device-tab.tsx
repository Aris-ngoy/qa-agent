import { useApps } from "@/features/apps/hooks/use-apps";
import { shownAutoChat$ } from "@/features/auto/data/state/shown-chat";
import { isRunLive } from "@/features/auto/utils/run-card";
import { screenAspect } from "@/features/devices/utils/web-device";
import { LiveFrame } from "@/features/inspector/components/live-frame";
import { useInspectorFeed } from "@/features/inspector/hooks/use-inspector-feed";
import { useValue } from "@legendapp/state/react";
import { useRef } from "react";

/**
 * The connected device's live frames, through the Inspector's Frame Feed, with the Action the
 * chat's Run is taking overlaid. View only: Auto never connects, switches or drives the device
 * here; the top bar owns the Device Session.
 */
export function AutoDeviceTab() {
	const { selectedApp } = useApps();
	const feed = useInspectorFeed(selectedApp?.id);
	const imgRef = useRef<HTMLImageElement | null>(null);
	const hasFrame = useValue(() => feed.feed$.imageUrl.get() != null);
	const loading = useValue(() => feed.feed$.bootLoading.get() && feed.feed$.imageUrl.get() == null);
	const feedMode = useValue(feed.feed$.feedMode);
	const unreachable = useValue(feed.feed$.unreachable);
	const action = useValue(() => {
		const run = shownAutoChat$.chat.run.get();
		if (!run || !isRunLive(run)) return null;
		return run.currentCommand ?? (run.currentStep ? `Step ${run.currentStep}` : null);
	});
	const session = feed.activeSession;
	const pageAspect = session ? screenAspect(session.platform, session.viewport) : null;
	const frameRadius = pageAspect ? "rounded-lg" : "rounded-[28px]";
	const liveLabel = unreachable
		? "Waiting for device"
		: feedMode === "poll"
			? "Poll"
			: feedMode === "mjpeg"
				? "Stream"
				: null;

	return (
		<div className="flex h-full min-h-0 flex-col gap-2">
			<div className="flex min-h-6 items-center gap-2">
				{liveLabel && hasFrame ? (
					<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-2 py-0.5 text-helper font-semibold text-on-secondary-container">
						<span className="relative flex size-1.5">
							<span className="absolute inline-flex size-full animate-ping rounded-full bg-secondary opacity-60" />
							<span className="relative inline-flex size-1.5 rounded-full bg-secondary" />
						</span>
						{liveLabel}
					</span>
				) : null}
				{session?.heldByRun ? (
					<span className="text-helper text-on-surface-variant">
						A Run holds the device · view only
					</span>
				) : null}
			</div>

			<div className="relative flex min-h-56 flex-1 items-center justify-center rounded-xl bg-surface-container p-3">
				{hasFrame ? (
					<div className="relative w-fit max-w-full">
						<LiveFrame
							className={`pointer-events-none block max-h-[max(260px,calc(100vh-14rem))] w-auto max-w-full ${frameRadius} shadow-float select-none`}
							imgRef={imgRef}
							src$={feed.feed$.imageUrl}
						/>
						{action ? (
							<output
								aria-live="polite"
								className="motion-fade-in absolute inset-x-3 bottom-3 truncate rounded-lg bg-inverse-surface/85 px-2.5 py-1.5 text-center font-mono text-[11px] text-inverse-on-surface shadow-float"
								title={action}
							>
								{action}
							</output>
						) : null}
					</div>
				) : loading ? (
					<output
						aria-live="polite"
						className="motion-fade-in flex flex-col items-center justify-center gap-3"
					>
						<div
							className={[
								"motion-skeleton h-[min(24rem,calc(100vh-24rem))] min-h-48 max-w-full bg-surface-container-high",
								pageAspect ? "" : "aspect-[9/19]",
								frameRadius,
							].join(" ")}
							style={pageAspect ? { aspectRatio: pageAspect } : undefined}
						/>
						<span className="text-body-sm text-on-surface-variant">Starting live feed…</span>
					</output>
				) : (
					<div className="flex flex-col items-center justify-center gap-2 px-6 text-center">
						<p className="m-0 text-body-sm font-medium text-on-surface">
							{session ? "Waiting for the device" : "No device session"}
						</p>
						<p className="m-0 max-w-xs text-helper text-on-surface-variant">
							{session
								? "The live feed starts once the device answers."
								: "Connect a device from the top bar to watch it here."}
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
