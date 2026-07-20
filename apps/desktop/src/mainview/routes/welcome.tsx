import { useState } from "react";
import { useApps } from "../apps-context";
import { AddApplicationModal } from "../components/add-application-modal";

export function WelcomePage() {
	const { apps, hasApps, addApp } = useApps();
	const [modalOpen, setModalOpen] = useState(false);

	return (
		<>
			<div className="-mx-container -my-gutter flex min-h-full items-center justify-center bg-surface-container-lowest px-4">
				{hasApps ? (
					<section className="w-full max-w-md rounded-md border border-outline-variant bg-surface-container-lowest p-12 text-center shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
						<h1 className="mb-4 text-headline-lg text-on-surface">Application ready</h1>
						<p className="mb-8 text-body-md leading-relaxed text-on-surface-variant">
							{apps.length === 1
								? `${apps[0]?.name} is set up locally. Test Cases come next.`
								: `${apps.length} applications are set up locally. Test Cases come next.`}
						</p>
						<ul className="mb-8 space-y-stack-sm text-left">
							{apps.map((app) => (
								<li
									key={app.id}
									className="rounded border border-outline-variant bg-surface-container-low px-4 py-3 text-body-md text-on-surface"
								>
									{app.name}
								</li>
							))}
						</ul>
						<button
							className="inline-flex items-center justify-center gap-2 rounded bg-primary px-8 py-3 text-body-md font-medium text-on-primary transition-opacity hover:opacity-90"
							onClick={() => setModalOpen(true)}
							type="button"
						>
							<span aria-hidden="true">+</span>
							Add another
						</button>
					</section>
				) : (
					<section className="w-full max-w-md rounded-md border border-outline-variant bg-surface-container-lowest p-12 text-center shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
						<h1 className="mb-4 text-headline-lg text-on-surface">Welcome to qa-agent</h1>
						<p className="mb-8 text-body-md leading-relaxed text-on-surface-variant">
							You don&apos;t have any applications yet. Create one to start testing your mobile
							apps.
						</p>
						<button
							className="inline-flex w-full items-center justify-center gap-2 rounded bg-primary px-8 py-3 text-body-md font-medium text-on-primary transition-opacity hover:opacity-90 sm:w-auto"
							onClick={() => setModalOpen(true)}
							type="button"
						>
							<svg aria-hidden="true" className="size-5" fill="currentColor" viewBox="0 0 20 20">
								<path
									clipRule="evenodd"
									d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z"
									fillRule="evenodd"
								/>
							</svg>
							Add application
						</button>
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
