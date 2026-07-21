import { type AppiumCapability, useApps } from "@/features/apps/context";
import { AlertDialog, Button, Description, Input, Label, TextArea, TextField } from "@heroui/react";
import { type SVGProps, useEffect, useState } from "react";

type FormState = {
	name: string;
	context: string;
	iosBundleId: string;
	iosAppStoreId: string;
	androidApplicationId: string;
	capabilities: AppiumCapability[];
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

function capabilitiesEqual(a: AppiumCapability[], b: AppiumCapability[]): boolean {
	if (a.length !== b.length) return false;
	return a.every(
		(cap, index) =>
			cap.id === b[index]?.id && cap.key === b[index]?.key && cap.value === b[index]?.value,
	);
}

function formFromApp(app: {
	name: string;
	context: string;
	iosBundleId: string;
	iosAppStoreId: string;
	androidApplicationId: string;
	capabilities: AppiumCapability[];
}): FormState {
	return {
		name: app.name,
		context: app.context,
		iosBundleId: app.iosBundleId,
		iosAppStoreId: app.iosAppStoreId,
		androidApplicationId: app.androidApplicationId,
		capabilities: app.capabilities.map((cap) => ({ ...cap })),
	};
}

export function ConfigurationPage() {
	const { selectedApp, updateApp, deleteApp } = useApps();
	const [form, setForm] = useState<FormState | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);

	useEffect(() => {
		if (selectedApp) {
			setForm(formFromApp(selectedApp));
		} else {
			setForm(null);
		}
	}, [selectedApp]);

	if (!selectedApp || !form) {
		return null;
	}

	const dirty =
		form.name.trim() !== selectedApp.name ||
		form.context !== selectedApp.context ||
		form.iosBundleId !== selectedApp.iosBundleId ||
		form.iosAppStoreId !== selectedApp.iosAppStoreId ||
		form.androidApplicationId !== selectedApp.androidApplicationId ||
		!capabilitiesEqual(form.capabilities, selectedApp.capabilities);

	const canSave = dirty && form.name.trim().length > 0;

	const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
		setForm((current) => (current ? { ...current, [key]: value } : current));
	};

	const addCapability = () => {
		setForm((current) =>
			current
				? {
						...current,
						capabilities: [
							...current.capabilities,
							{ id: `cap_${crypto.randomUUID()}`, key: "", value: "" },
						],
					}
				: current,
		);
	};

	const updateCapability = (
		id: string,
		patch: Partial<Pick<AppiumCapability, "key" | "value">>,
	) => {
		setForm((current) =>
			current
				? {
						...current,
						capabilities: current.capabilities.map((cap) =>
							cap.id === id ? { ...cap, ...patch } : cap,
						),
					}
				: current,
		);
	};

	const removeCapability = (id: string) => {
		setForm((current) =>
			current
				? {
						...current,
						capabilities: current.capabilities.filter((cap) => cap.id !== id),
					}
				: current,
		);
	};

	const handleSave = () => {
		if (!canSave) return;
		updateApp(selectedApp.id, {
			name: form.name.trim(),
			context: form.context,
			iosBundleId: form.iosBundleId.trim(),
			iosAppStoreId: form.iosAppStoreId.trim(),
			androidApplicationId: form.androidApplicationId.trim(),
			capabilities: form.capabilities
				.map((cap) => ({
					...cap,
					key: cap.key.trim(),
					value: cap.value.trim(),
				}))
				.filter((cap) => cap.key.length > 0),
		});
	};

	const handleDelete = () => {
		deleteApp(selectedApp.id);
		setDeleteOpen(false);
	};
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 pb-8">
			<header className="flex items-center justify-between gap-4">
				<h1 className="text-headline-lg text-on-surface">Settings</h1>
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
						isDisabled={!canSave}
						onPress={handleSave}
					>
						Save
					</Button>
				</div>
			</header>

			<section className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
				<h2 className="mb-5 text-headline-md text-on-surface">General</h2>
				<div className="flex flex-col gap-5">
					<TextField
						className="w-full"
						name="appName"
						onChange={(value) => setField("name", value)}
						value={form.name}
					>
						<Label className="mb-1.5 text-subheading text-on-surface">App Name</Label>
						<Input className={fieldInputClass} placeholder="My application" />
					</TextField>

					<div className="flex flex-col gap-2">
						<p className="text-body-sm leading-relaxed text-on-surface-variant">
							Provide additional context about your application that will be used by the agent when
							executing all tests. This helps the agent better understand your app&apos;s specific
							navigation, functionality and behavior.
						</p>
						<TextField
							className="w-full"
							name="context"
							onChange={(value) => setField("context", value)}
							value={form.context}
						>
							<Label className="mb-1.5 text-subheading text-on-surface">Application Context</Label>
							<TextArea
								className={`${fieldInputClass} min-h-28 resize-y rounded-xl`}
								placeholder="e.g., This is a music streaming app with subscription tiers. Users can listen to free music with ads or upgrade to premium for ad-free experience..."
								rows={5}
							/>
						</TextField>
					</div>
				</div>
			</section>

			<section className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
				<h2 className="mb-5 text-headline-md text-on-surface">Local Testing with Desktop app</h2>

				<div className="flex flex-col gap-6">
					<div>
						<h3 className="mb-3 text-subheading text-on-surface">iOS</h3>
						<div className="flex flex-col gap-4">
							<TextField
								className="w-full"
								name="iosBundleId"
								onChange={(value) => setField("iosBundleId", value)}
								value={form.iosBundleId}
							>
								<Label className="mb-1.5 text-subheading text-on-surface">Bundle ID</Label>
								<Input className={fieldInputClass} placeholder="com.example.app" />
								<Description className="mt-1.5 text-helper text-on-surface-variant">
									Required for TestFlight, App Store, and No build runs
								</Description>
							</TextField>

							<TextField
								className="w-full"
								name="iosAppStoreId"
								onChange={(value) => setField("iosAppStoreId", value)}
								value={form.iosAppStoreId}
							>
								<Label className="mb-1.5 text-subheading text-on-surface">App Store ID</Label>
								<Input className={fieldInputClass} placeholder="12345678" />
								<Description className="mt-1.5 text-helper text-on-surface-variant">
									Required for TestFlight and App Store builds
								</Description>
							</TextField>
						</div>
					</div>

					<div>
						<h3 className="mb-3 text-subheading text-on-surface">Android</h3>
						<TextField
							className="w-full"
							name="androidApplicationId"
							onChange={(value) => setField("androidApplicationId", value)}
							value={form.androidApplicationId}
						>
							<Label className="mb-1.5 text-subheading text-on-surface">Application ID</Label>
							<Input className={fieldInputClass} placeholder="com.example.app" />
							<Description className="mt-1.5 text-helper text-on-surface-variant">
								Required for Android runs without uploading a build
							</Description>
						</TextField>
					</div>
				</div>
			</section>

			<section className="rounded-2xl border border-outline-variant/80 bg-surface-container-lowest p-6 shadow-card">
				<div className="mb-5">
					<h2 className="mb-2 text-headline-md text-on-surface">Custom Appium Capabilities</h2>
					<p className="text-body-md text-on-surface-variant">
						Add custom Appium capabilities that will be passed to the driver when running tests.
						These are merged with system capabilities.
					</p>
				</div>

				{form.capabilities.length > 0 ? (
					<ul className="mb-4 flex flex-col gap-3">
						{form.capabilities.map((cap) => (
							<li className="flex items-start gap-2" key={cap.id}>
								<TextField
									aria-label="Capability key"
									className="min-w-0 flex-1"
									name={`cap-key-${cap.id}`}
									onChange={(value) => updateCapability(cap.id, { key: value })}
									value={cap.key}
								>
									<Input className={fieldInputClass} placeholder="appium:autoLaunch" />
								</TextField>
								<TextField
									aria-label="Capability value"
									className="min-w-0 flex-1"
									name={`cap-value-${cap.id}`}
									onChange={(value) => updateCapability(cap.id, { value })}
									value={cap.value}
								>
									<Input className={fieldInputClass} placeholder="false" />
								</TextField>
								<Button
									aria-label="Remove capability"
									className="size-10 min-w-10 shrink-0 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
									onPress={() => removeCapability(cap.id)}
									variant="ghost"
								>
									<TrashIcon />
								</Button>
							</li>
						))}
					</ul>
				) : null}

				<button
					className="inline-flex items-center gap-2 rounded-lg bg-surface-container px-4 py-2 text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high"
					onClick={addCapability}
					type="button"
				>
					<svg aria-hidden="true" className="size-[18px]" fill="currentColor" viewBox="0 0 20 20">
						<path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
					</svg>
					Add capability
				</button>
			</section>
		</div>
	);
}
