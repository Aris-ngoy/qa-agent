import { RhfTextField, requiredTrimmed } from "@/app/forms";
import { useApps } from "@/features/apps/context";
import { AlertDialog, Button, Form } from "@heroui/react";
import { type SVGProps, useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";

type FormValues = {
	name: string;
	context: string;
	iosBundleId: string;
	iosAppStoreId: string;
	androidApplicationId: string;
};

function TrashIcon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		>
			<path
				d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

const fieldInputClass =
	"w-full rounded-lg border-none bg-surface-container px-3.5 py-2.5 text-body-md text-on-surface shadow-none placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/10";

function formFromApp(app: {
	name: string;
	context: string;
	iosBundleId: string;
	iosAppStoreId: string;
	androidApplicationId: string;
}): FormValues {
	return {
		name: app.name,
		context: app.context,
		iosBundleId: app.iosBundleId,
		iosAppStoreId: app.iosAppStoreId,
		androidApplicationId: app.androidApplicationId,
	};
}

export function ConfigurationPage() {
	const { selectedApp, updateApp, deleteApp } = useApps();
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [ready, setReady] = useState(false);

	const {
		control,
		handleSubmit,
		reset,
		formState: { isDirty, isValid },
	} = useForm<FormValues>({
		defaultValues: {
			name: "",
			context: "",
			iosBundleId: "",
			iosAppStoreId: "",
			androidApplicationId: "",
		},
		mode: "onChange",
	});

	const nameValue = useWatch({ control, name: "name" });

	useEffect(() => {
		if (selectedApp) {
			reset(formFromApp(selectedApp));
			setReady(true);
		} else {
			setReady(false);
		}
	}, [selectedApp, reset]);

	if (!selectedApp || !ready) {
		return null;
	}

	const canSave = isDirty && (nameValue?.trim().length ?? 0) > 0 && isValid;

	const onSubmit = (values: FormValues) => {
		void updateApp(selectedApp.id, {
			name: values.name.trim(),
			context: values.context,
			iosBundleId: values.iosBundleId.trim(),
			iosAppStoreId: values.iosAppStoreId.trim(),
			androidApplicationId: values.androidApplicationId.trim(),
		});
	};

	const handleDelete = () => {
		void deleteApp(selectedApp.id);
		setDeleteOpen(false);
	};

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
			<header className="flex items-center justify-between gap-4">
				<h1 className="text-headline-lg text-on-surface">Configuration</h1>
				<div className="flex items-center gap-2">
					<AlertDialog>
						<Button
							aria-label="Delete application"
							className="size-10 min-w-10 rounded-lg bg-transparent text-error data-[hovered=true]:bg-error-container/40"
							onPress={() => setDeleteOpen(true)}
							variant="ghost"
						>
							<TrashIcon />
						</Button>
						<AlertDialog.Backdrop isOpen={deleteOpen} onOpenChange={setDeleteOpen}>
							<AlertDialog.Container>
								<AlertDialog.Dialog className="sm:max-w-[400px]">
									<AlertDialog.CloseTrigger />
									<AlertDialog.Header>
										<AlertDialog.Icon status="danger" />
										<AlertDialog.Heading>Delete application?</AlertDialog.Heading>
									</AlertDialog.Header>
									<AlertDialog.Body>
										<p>
											This will permanently delete <strong>{selectedApp.name}</strong> and its local
											configuration. This action cannot be undone.
										</p>
									</AlertDialog.Body>
									<AlertDialog.Footer>
										<Button slot="close" variant="tertiary">
											Cancel
										</Button>
										<Button onPress={handleDelete} variant="danger">
											Delete
										</Button>
									</AlertDialog.Footer>
								</AlertDialog.Dialog>
							</AlertDialog.Container>
						</AlertDialog.Backdrop>
					</AlertDialog>

					<Button
						className="rounded-lg bg-primary px-5 text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
						form="app-configuration-form"
						isDisabled={!canSave}
						type="submit"
					>
						Save
					</Button>
				</div>
			</header>

			<Form
				className="flex flex-col gap-6"
				id="app-configuration-form"
				onSubmit={handleSubmit(onSubmit)}
			>
				<section className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
					<h2 className="mb-5 text-headline-md text-on-surface">General</h2>
					<div className="flex flex-col gap-5">
						<RhfTextField
							control={control}
							inputClassName={fieldInputClass}
							label="App Name"
							name="name"
							placeholder="My application"
							rules={requiredTrimmed("App name is required")}
						/>

						<div className="flex flex-col gap-2">
							<p className="text-body-sm leading-relaxed text-on-surface-variant">
								Provide additional context about your application that will be used by the agent
								when executing all tests. This helps the agent better understand your app&apos;s
								specific navigation, functionality and behavior.
							</p>
							<RhfTextField
								control={control}
								inputClassName={`${fieldInputClass} min-h-28 resize-y rounded-xl`}
								label="Application Context"
								multiline
								name="context"
								placeholder="e.g., This is a music streaming app with subscription tiers. Users can listen to free music with ads or upgrade to premium for ad-free experience..."
								rows={5}
							/>
						</div>
					</div>
				</section>

				<section className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
					<h2 className="mb-5 text-headline-md text-on-surface">Local Testing with Desktop app</h2>

					<div className="flex flex-col gap-6">
						<div>
							<h3 className="mb-3 text-subheading text-on-surface">iOS</h3>
							<div className="flex flex-col gap-4">
								<RhfTextField
									control={control}
									description="Required for TestFlight, App Store, and No build runs"
									inputClassName={fieldInputClass}
									label="Bundle ID"
									name="iosBundleId"
									placeholder="com.example.app"
								/>

								<RhfTextField
									control={control}
									description="Required for TestFlight and App Store builds"
									inputClassName={fieldInputClass}
									label="App Store ID"
									name="iosAppStoreId"
									placeholder="12345678"
								/>
							</div>
						</div>

						<div>
							<h3 className="mb-3 text-subheading text-on-surface">Android</h3>
							<RhfTextField
								control={control}
								description="Required for Android runs without uploading a build"
								inputClassName={fieldInputClass}
								label="Application ID"
								name="androidApplicationId"
								placeholder="com.example.app"
							/>
						</div>
					</div>
				</section>
			</Form>
		</div>
	);
}
