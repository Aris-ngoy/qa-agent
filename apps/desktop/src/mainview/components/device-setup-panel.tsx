import { Modal, ProgressCircle } from "@heroui/react";
import type { SelectedDevice } from "./select-device-modal";

type DeviceSetupPanelProps = {
	device: SelectedDevice;
	open: boolean;
	onCancel: () => void;
};

export function DeviceSetupPanel({ device, open, onCancel }: DeviceSetupPanelProps) {
	const title = `Setting up ${device.name} (${device.osVersion})...`;

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

							<div className="flex max-w-md flex-col items-center gap-1.5 text-center">
								<p className="text-body-md font-medium text-on-surface">
									Setting up the test runner on your device...
								</p>
								<p className="text-body-sm text-on-surface-variant">
									This takes 1–2 minutes on the first run
								</p>
							</div>
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
