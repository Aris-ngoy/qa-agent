import { AddApplicationModal } from "@/features/apps/add-application-modal";
import { useApps } from "@/features/apps/context";
import { Button } from "@heroui/react";
import { Navigate } from "@tanstack/react-router";
import { useState } from "react";

export function WelcomePage() {
	const { hasApps, addApp, selectedApp } = useApps();
	const [modalOpen, setModalOpen] = useState(false);

	if (selectedApp) {
		return <Navigate to="/status" />;
	}

	return (
		<>
			<div className="flex min-h-full items-center justify-center px-4 py-10">
				<section className="w-full max-w-lg rounded-[var(--radius-platform)] bg-surface-container-lowest px-10 py-12 text-center shadow-soft">
					<span className="mx-auto mb-6 flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-card-lavender to-card-rose text-2xl font-bold text-primary shadow-card">
						Q
					</span>
					<h1 className="mb-3 text-headline-lg font-semibold tracking-tight text-on-surface">
						qa-agent
					</h1>
					<p className="mb-8 text-body-md leading-relaxed text-on-surface-variant">
						{hasApps
							? "Select an app from the sidebar to open its runner status, test cases, and recent runs."
							: "Add a mobile app to start running local automated tests against simulators and emulators."}
					</p>
					<Button
						className="h-12 w-full max-w-sm rounded-full bg-primary text-on-primary data-[hovered=true]:bg-primary/90"
						onPress={() => setModalOpen(true)}
					>
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
