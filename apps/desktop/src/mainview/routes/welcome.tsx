import { Button } from "@heroui/react";
import { useState } from "react";
import { useApps } from "../apps-context";
import { AddApplicationModal } from "../components/add-application-modal";

export function WelcomePage() {
	const { apps, hasApps, addApp, selectedApp } = useApps();
	const [modalOpen, setModalOpen] = useState(false);

	return (
		<>
			<div className="-mx-container -my-gutter flex min-h-full items-center justify-center bg-surface-container-lowest px-4">
				{hasApps ? (
					<section className="w-full max-w-md rounded-md border border-outline-variant bg-surface-container-lowest p-12 text-center shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
						<h1 className="mb-4 text-headline-lg text-on-surface">Application ready</h1>
						<p className="mb-8 text-body-md leading-relaxed text-on-surface-variant">
							{selectedApp
								? `${selectedApp.name} is selected. Use the header to switch apps or run tests.`
								: `${apps.length} application${apps.length === 1 ? "" : "s"} ready. Select one from the header.`}
						</p>
						<ul className="mb-8 space-y-stack-sm text-left">
							{apps.map((app) => (
								<li
									key={app.id}
									className="rounded border border-outline-variant bg-surface-container-low px-4 py-3 text-body-md text-on-surface"
								>
									{app.name}
									{app.id === selectedApp?.id ? (
										<span className="ml-2 text-helper text-secondary">Selected</span>
									) : null}
								</li>
							))}
						</ul>
						<Button onPress={() => setModalOpen(true)}>
							<span aria-hidden="true">+</span>
							Add another
						</Button>
					</section>
				) : (
					<section className="w-full max-w-md rounded-md border border-outline-variant bg-surface-container-lowest p-12 text-center shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
						<h1 className="mb-4 text-headline-lg text-on-surface">Welcome to qa-agent</h1>
						<p className="mb-8 text-body-md leading-relaxed text-on-surface-variant">
							You don&apos;t have any applications yet. Create one from the header, or use the
							button below.
						</p>
						<Button className="w-full sm:w-auto" onPress={() => setModalOpen(true)}>
							<svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 20 20">
								<path
									clipRule="evenodd"
									d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
									fillRule="evenodd"
								/>
							</svg>
							Add application
						</Button>
					</section>
				)}
			</div>

			<AddApplicationModal
				onAdd={(name) => {
					addApp(name);
				}}
				onClose={() => setModalOpen(false)}
				open={modalOpen}
			/>
		</>
	);
}
