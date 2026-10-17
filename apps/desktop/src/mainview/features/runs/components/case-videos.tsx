import { fileSafeName } from "@/features/runs/utils/run-steps";
import { Button, Modal, toast } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import type { RunTest } from "@yoqa/runner-client";

function PlayIcon() {
	return (
		<svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
			<path d="M8 5.5v13l11-6.5L8 5.5Z" />
		</svg>
	);
}

/** Plays one case's video in a dialog and lets the user save the file. */
function VideoDialog({
	title,
	url,
	onClose,
	onDelete,
}: {
	title: string;
	url: string | null;
	onClose: () => void;
	onDelete: () => Promise<void>;
}) {
	const dialog$ = useObservable({ saving: false, confirmingDelete: false, deleting: false });
	const saving = useValue(dialog$.saving);
	const confirmingDelete = useValue(dialog$.confirmingDelete);
	const deleting = useValue(dialog$.deleting);

	const remove = async () => {
		dialog$.deleting.set(true);
		try {
			await onDelete();
			dialog$.confirmingDelete.set(false);
			onClose();
		} catch (error) {
			toast.danger(error instanceof Error ? error.message : "Delete failed");
		} finally {
			dialog$.deleting.set(false);
		}
	};

	const download = async () => {
		if (!url) return;
		dialog$.saving.set(true);
		try {
			const response = await fetch(url);
			if (!response.ok) throw new Error(`Download failed (${response.status})`);
			const blobUrl = URL.createObjectURL(await response.blob());
			const anchor = document.createElement("a");
			anchor.href = blobUrl;
			anchor.download = `${fileSafeName(title)}.mp4`;
			anchor.click();
			URL.revokeObjectURL(blobUrl);
		} catch (error) {
			toast.danger(error instanceof Error ? error.message : "Download failed");
		} finally {
			dialog$.saving.set(false);
		}
	};

	return (
		<Modal>
			<Modal.Backdrop
				isOpen={url !== null}
				onOpenChange={(next) => {
					if (next) return;
					dialog$.confirmingDelete.set(false);
					onClose();
				}}
			>
				<Modal.Container placement="center" size="lg">
					<Modal.Dialog className="gap-4 p-5">
						<Modal.CloseTrigger />
						<p className="pr-8 text-body-md font-medium text-on-surface">{title}</p>
						{url ? (
							// biome-ignore lint/a11y/useMediaCaption: a device screen recording has no audio track
							<video
								autoPlay
								className="max-h-[70vh] w-full rounded-xl bg-scrim object-contain"
								controls
								src={url}
							/>
						) : null}
						{confirmingDelete ? (
							<div className="flex flex-wrap items-center justify-between gap-3">
								<p className="text-body-sm text-on-surface-variant">
									Delete this video? This cannot be undone.
								</p>
								<div className="flex gap-2">
									<Button
										isDisabled={deleting}
										onPress={() => dialog$.confirmingDelete.set(false)}
										variant="secondary"
									>
										Cancel
									</Button>
									<Button isDisabled={deleting} onPress={() => void remove()} variant="danger">
										{deleting ? "Deleting…" : "Delete"}
									</Button>
								</div>
							</div>
						) : (
							<div className="flex justify-end gap-2">
								<Button onPress={() => dialog$.confirmingDelete.set(true)} variant="danger-soft">
									Delete video
								</Button>
								<Button isDisabled={saving} onPress={() => void download()} variant="secondary">
									{saving ? "Downloading…" : "Download video"}
								</Button>
							</div>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

/**
 * The cases that were recorded, each as a button that opens its video. Shown only once the Run
 * has finished: while it is live (or a video is still being saved) there is nothing to show yet.
 */
export function CaseVideos({
	tests,
	label,
	videoUrl,
	onDelete,
}: {
	tests: RunTest[];
	label: (test: RunTest) => string;
	videoUrl: (test: RunTest) => string | null;
	onDelete: (test: RunTest) => Promise<void>;
}) {
	const openTestId$ = useObservable<string | null>(null);
	const openTestId = useValue(openTestId$);
	const finished = tests.filter((test) => test.recording && test.recording.status !== "recording");
	if (finished.length === 0) return null;
	const openTest = finished.find((test) => test.id === openTestId);

	return (
		<div className="flex flex-col gap-3">
			<p className="text-helper font-medium text-on-surface-variant">Video</p>
			{finished.map((test) => {
				const ready = test.recording?.status === "ready";
				return ready ? (
					<button
						aria-label={`Play video: ${label(test)}`}
						className="motion-press flex w-full items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-low px-4 py-3 text-left transition-colors data-[hovered=true]:bg-surface-container hover:bg-surface-container"
						key={test.id}
						onClick={() => openTestId$.set(test.id)}
						type="button"
					>
						<span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary">
							<PlayIcon />
						</span>
						<span className="flex min-w-0 flex-col">
							<span className="truncate text-body-md font-medium text-on-surface">
								{label(test)}
							</span>
							<span className="text-body-sm text-on-surface-variant">Play or download video</span>
						</span>
					</button>
				) : (
					<div
						className="rounded-2xl border border-dashed border-outline-variant px-4 py-3"
						key={test.id}
					>
						<p className="truncate text-body-md text-on-surface">{label(test)}</p>
						<p className="text-body-sm text-on-surface-variant">
							Video unavailable{test.recording?.note ? `: ${test.recording.note}` : ""}
						</p>
					</div>
				);
			})}
			<VideoDialog
				onClose={() => openTestId$.set(null)}
				onDelete={() => (openTest ? onDelete(openTest) : Promise.resolve())}
				title={openTest ? label(openTest) : ""}
				url={openTest ? videoUrl(openTest) : null}
			/>
		</div>
	);
}
