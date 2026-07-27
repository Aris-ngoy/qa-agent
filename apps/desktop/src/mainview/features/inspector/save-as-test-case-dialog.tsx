import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { useEffect, useState } from "react";

type SaveAsTestCaseDialogProps = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	defaultName: string;
	appName: string | null;
	actionCount: number;
	warnings: string[];
	saving: boolean;
	error: string | null;
	onConfirm: (name: string) => void;
};

export function SaveAsTestCaseDialog({
	isOpen,
	onOpenChange,
	defaultName,
	appName,
	actionCount,
	warnings,
	saving,
	error,
	onConfirm,
}: SaveAsTestCaseDialogProps) {
	const [name, setName] = useState(defaultName);

	useEffect(() => {
		if (isOpen) setName(defaultName);
	}, [defaultName, isOpen]);

	const canSave = name.trim().length > 0 && actionCount > 0 && !saving;

	return (
		<Modal>
			<Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange} variant="opaque">
				<Modal.Container placement="center" size="md">
					<Modal.Dialog className="sm:max-w-md">
						<Modal.CloseTrigger />
						<Modal.Header className="flex flex-col gap-1">
							<Modal.Heading>Save as test case</Modal.Heading>
							<p className="text-body-sm text-on-surface-variant">
								Creates a new case
								{appName ? (
									<>
										{" "}
										in <span className="font-medium text-on-surface">{appName}</span>
									</>
								) : null}{" "}
								with a replayable script ({actionCount} action
								{actionCount === 1 ? "" : "s"}).
							</p>
						</Modal.Header>
						<Modal.Body className="gap-3">
							<TextField className="w-full" value={name} onChange={setName} isRequired>
								<Label className="mb-1 text-helper text-on-surface-variant">Name</Label>
								<Input
									placeholder="e.g. Settings — open General"
									autoFocus
									onKeyDown={(event) => {
										if (event.key === "Enter" && canSave) {
											event.preventDefault();
											onConfirm(name.trim());
										}
									}}
								/>
							</TextField>

							{warnings.length > 0 ? (
								<div className="rounded-lg border border-outline-variant/40 bg-surface-container/60 px-3 py-2">
									<p className="mb-1 text-helper font-semibold text-on-surface-variant">
										Some lines were skipped
									</p>
									<ul className="flex max-h-28 flex-col gap-0.5 overflow-y-auto font-mono text-[11px] text-on-surface-variant">
										{warnings.map((warning) => (
											<li key={warning}>{warning}</li>
										))}
									</ul>
								</div>
							) : null}

							{error ? <p className="text-body-sm text-error">{error}</p> : null}
						</Modal.Body>
						<Modal.Footer>
							<Button
								size="sm"
								variant="secondary"
								isDisabled={saving}
								onPress={() => {
									onOpenChange(false);
								}}
							>
								Cancel
							</Button>
							<Button
								size="sm"
								variant="primary"
								isDisabled={!canSave}
								onPress={() => {
									onConfirm(name.trim());
								}}
							>
								{saving ? "Saving…" : "Create test case"}
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
