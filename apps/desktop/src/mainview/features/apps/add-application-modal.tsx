import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { useEffect, useState } from "react";

type AddApplicationModalProps = {
	open: boolean;
	onClose: () => void;
	onAdd: (name: string) => void;
};

export function AddApplicationModal({ open, onClose, onAdd }: AddApplicationModalProps) {
	const [name, setName] = useState("");

	useEffect(() => {
		if (open) {
			setName("");
		}
	}, [open]);

	const trimmed = name.trim();
	const canCreate = trimmed.length > 0;

	const submit = () => {
		if (!canCreate) return;
		onAdd(trimmed);
		onClose();
	};

	return (
		<Modal>
			<Modal.Backdrop isOpen={open} onOpenChange={(next) => !next && onClose()} variant="opaque">
				<Modal.Container placement="center" size="md">
					<Modal.Dialog className="sm:max-w-lg">
						<Modal.CloseTrigger />
						<Modal.Header>
							<Modal.Heading className="text-headline-md text-on-surface">
								Create application
							</Modal.Heading>
						</Modal.Header>
						<Modal.Body className="gap-4">
							<p className="text-body-md text-on-surface-variant">
								Add the mobile app you want to test. You can configure bundle IDs and Appium
								capabilities after it is created.
							</p>
							<TextField className="w-full" name="app-name" onChange={setName} value={name}>
								<Label className="mb-1.5 text-subheading text-on-surface">
									App name <span className="text-error">*</span>
								</Label>
								<Input
									autoFocus
									className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md text-on-surface shadow-none placeholder:text-on-surface-variant/65 focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/10"
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											submit();
										}
									}}
									placeholder="e.g. My Banking App"
								/>
							</TextField>
						</Modal.Body>
						<Modal.Footer className="gap-2">
							<Button
								className="rounded-xl bg-surface-container px-4 text-on-surface"
								onPress={onClose}
								variant="secondary"
							>
								Cancel
							</Button>
							<Button
								className="rounded-xl bg-primary px-4 text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
								isDisabled={!canCreate}
								onPress={submit}
							>
								Create app
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
