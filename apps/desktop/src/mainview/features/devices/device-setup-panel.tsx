import { Button, Modal, ProgressCircle } from "@heroui/react";
import type { SelectedDevice } from "./select-device-modal";

export type DeviceSetupStatus = "loading" | "error";

type DeviceSetupPanelProps = {
	device: SelectedDevice;
	open: boolean;
	status: DeviceSetupStatus;
	/** Progress or error detail from the runner */
	message?: string | null;
	onCancel: () => void;
	onRetry: () => void;
};

export function DeviceSetupPanel({
	device,
	open,
	status,
	message,
	onCancel,
	onRetry,
}: DeviceSetupPanelProps) {
	const title = `Setting up ${device.name} (${device.osVersion})...`;
	const isError = status === "error";

	return (
		<Modal>
			<Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onCancel()} variant="opaque">
				<Modal.Container placement="center" size="cover">
					<Modal.Dialog className="h-[min(36rem,85vh)] w-full max-w-5xl overflow-hidden rounded-2xl bg-surface-container-low shadow-float">
						<Modal.Header className="flex items-center justify-between gap-4 border-none px-6 py-5">
							<Modal.Heading className="text-headline-md font-semibold text-on-surface">
								{title}
							</Modal.Heading>
							<Modal.CloseTrigger aria-label="Cancel device setup" />
						</Modal.Header>
						<Modal.Body className="flex flex-1 flex-col items-center justify-center gap-4 px-6 pb-20 pt-0">
							{isError ? null : (
								<ProgressCircle
									aria-label="Installing test runner"
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
							)}

							<div className="flex max-w-md flex-col items-center gap-1.5 text-center">
								<p className="text-body-md font-medium text-on-surface">
									{isError
										? "Couldn’t set up the test runner"
										: "Setting up the test runner on your device..."}
								</p>
								<p
									className={`text-body-sm ${isError ? "text-danger" : "text-on-surface-variant"}`}
								>
									{isError
										? (message ?? "Something went wrong while installing Appium drivers.")
										: (message ?? "This takes 1–2 minutes on the first run")}
								</p>
							</div>

							{isError ? (
								<div className="mt-2 flex items-center gap-3">
									<Button onPress={onRetry} variant="primary">
										Retry
									</Button>
									<Button onPress={onCancel} variant="secondary">
										Cancel
									</Button>
								</div>
							) : null}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
