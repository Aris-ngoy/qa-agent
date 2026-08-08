import { RhfTextField, requiredTrimmed } from "@/app/forms";
import { Button, Form, Modal } from "@heroui/react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

type AddApplicationForm = {
	name: string;
};

type AddApplicationModalProps = {
	open: boolean;
	onClose: () => void;
	onAdd: (name: string) => void;
};

const inputClass =
	"w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3.5 py-3 text-body-md text-on-surface shadow-none placeholder:text-on-surface-variant/65 focus:border-primary/35 focus:outline-none focus:ring-2 focus:ring-primary/10";

export function AddApplicationModal({ open, onClose, onAdd }: AddApplicationModalProps) {
	const {
		control,
		handleSubmit,
		reset,
		formState: { isValid },
	} = useForm<AddApplicationForm>({
		defaultValues: { name: "" },
		mode: "onChange",
	});

	useEffect(() => {
		if (open) {
			reset({ name: "" });
		}
	}, [open, reset]);

	const onSubmit = (values: AddApplicationForm) => {
		onAdd(values.name.trim());
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
						<Form className="contents" onSubmit={handleSubmit(onSubmit)}>
							<Modal.Body className="gap-4">
								<p className="text-body-md text-on-surface-variant">
									Add the mobile app you want to test. You can configure bundle IDs and Appium
									capabilities after it is created.
								</p>
								<RhfTextField
									autoFocus
									control={control}
									inputClassName={inputClass}
									label={
										<>
											App name <span className="text-error">*</span>
										</>
									}
									name="name"
									placeholder="e.g. My Banking App"
									rules={requiredTrimmed("App name is required")}
								/>
							</Modal.Body>
							<Modal.Footer className="gap-2">
								<Button
									className="rounded-xl bg-surface-container px-4 text-on-surface"
									onPress={onClose}
									type="button"
									variant="secondary"
								>
									Cancel
								</Button>
								<Button
									className="rounded-xl bg-primary px-4 text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
									isDisabled={!isValid}
									type="submit"
								>
									Create app
								</Button>
							</Modal.Footer>
						</Form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
