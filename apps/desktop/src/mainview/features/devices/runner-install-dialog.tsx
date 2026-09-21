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
								Set up ArgentRunner on {device.name}
							</Modal.Heading>
							<Modal.CloseTrigger aria-label="Close runner install" />
						</Modal.Header>
						<Modal.Body className="flex flex-col items-center justify-center gap-4 px-5 pb-6 pt-0">
							{installing ? (
								<ProgressCircle
									aria-label="Setting up ArgentRunner"
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
										? "Couldn’t set up ArgentRunner"
										: installing
											? "Setting up ArgentRunner on your device..."
											: "This device needs the Argent test runner"}
								</p>
								<p className={`text-body-sm ${failed ? "text-danger" : "text-on-surface-variant"}`}>
									{failed
										? (message ?? "Something went wrong while installing the test runner.")
										: installing
											? (message ??
												"Building and signing the runner — first install takes 1–2 minutes.")
											: "ArgentRunner is a small helper app that lets Yoqa drive your device. Argent builds and signs it automatically with your Apple team — first setup takes 1–2 minutes. If the device asks, trust the developer under Settings → General → VPN & Device Management."}
								</p>
								{!installing && message ? (
									<p className="mt-1 max-w-md text-helper text-on-surface-variant/80">
										{failed ? null : message}
									</p>
								) : null}
								{!installing && !failed ? (
									<p className="mt-1 text-helper text-on-surface-variant">
										Requires a signing team in Settings → iOS (or ARGENT_IOS_TEAM_ID).
									</p>
								) : null}
							</div>

							<div className="mt-2 flex items-center gap-3">
								{failed ? (
									<>
										<Button onPress={onRetry} variant="primary">
											Retry
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
											Retry connect
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
