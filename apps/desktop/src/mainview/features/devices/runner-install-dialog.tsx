import { Button, Modal, ProgressCircle } from "@heroui/react";
import type { SelectedDevice } from "./select-device-modal";

export type RunnerInstallPhase = "prompt" | "installing" | "error";

type RunnerInstallDialogProps = {
	device: SelectedDevice;
	open: boolean;
	phase: RunnerInstallPhase;
	/** Connect failure detail (prompt) or install progress/error text */
	message?: string | null;
	onInstall: () => void;
	onRetry: () => void;
	onCancel: () => void;
};

export function RunnerInstallDialog({
	device,
	open,
	phase,
	message,
	onInstall,
	onRetry,
	onCancel,
}: RunnerInstallDialogProps) {
	const installing = phase === "installing";
	const failed = phase === "error";

	return (
		<Modal>
			<Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onCancel()} variant="opaque">
				<Modal.Container placement="center" size="cover">
					<Modal.Dialog className="w-full max-w-md overflow-hidden rounded-2xl bg-surface-container-low shadow-float">
						<Modal.Header className="flex items-center justify-between gap-4 border-none px-5 py-4">
							<Modal.Heading className="text-headline-md font-semibold text-on-surface">
								Install YoqaADRunner on {device.name}
							</Modal.Heading>
							<Modal.CloseTrigger aria-label="Close runner install" />
						</Modal.Header>
						<Modal.Body className="flex flex-col items-center justify-center gap-4 px-5 pb-6 pt-0">
							{installing ? (
								<ProgressCircle
									aria-label="Installing YoqaADRunner"
									className="text-on-surface-variant"
									color="default"
									isIndeterminate
									size="lg"
								>
									<ProgressCircle.Track>
										<ProgressCircle.TrackCircle className="stroke-outline-variant" />
										<ProgressCircle.FillCircle className="stroke-on-surface-variant" />
									</ProgressCircle.Track>
								</ProgressCircle>
							) : null}

							<div className="flex max-w-md flex-col items-center gap-1.5 text-center">
								<p className="text-body-md font-medium text-on-surface">
									{failed
										? "Couldn’t install YoqaADRunner"
										: installing
											? "Installing YoqaADRunner on your device..."
											: "This device needs the Yoqa test runner"}
								</p>
								<p className={`text-body-sm ${failed ? "text-danger" : "text-on-surface-variant"}`}>
									{failed
										? (message ?? "Something went wrong while installing the test runner.")
										: installing
											? (message ??
												"Building and signing the runner — first install takes 1–2 minutes.")
											: "YoqaADRunner is a small helper app that lets Yoqa drive your device. It is signed with your Apple team and shows the Yoqa icon on the home screen."}
								</p>
								{!installing && message ? (
									<p className="mt-1 max-w-md text-helper text-on-surface-variant/80">
										{failed ? null : message}
									</p>
								) : null}
								{!installing && !failed ? (
									<p className="mt-1 text-helper text-on-surface-variant">
										Requires a signing identity in Settings → iOS.
									</p>
								) : null}
							</div>

							<div className="mt-2 flex items-center gap-3">
								{failed ? (
									<>
										<Button onPress={onRetry} variant="primary">
											Retry install
										</Button>
										<Button onPress={onCancel} variant="secondary">
											Cancel
										</Button>
									</>
								) : installing ? (
									<Button onPress={onCancel} variant="secondary">
										Cancel
									</Button>
								) : (
									<>
										<Button onPress={onInstall} variant="primary">
											Install YoqaADRunner
										</Button>
										<Button onPress={onCancel} variant="secondary">
											Cancel
										</Button>
									</>
								)}
							</div>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
