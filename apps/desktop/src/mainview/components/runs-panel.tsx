export function RunsPanel() {
	return (
		<aside className="flex h-auto w-panel shrink-0 flex-col self-start rounded-[var(--radius-platform)] bg-surface-container-lowest/90 p-6 shadow-soft backdrop-blur-md">
			<div className="flex items-start justify-between gap-3">
				<div className="blob-actions flex items-center gap-4 px-5 py-4 shadow-card">
					<button
						aria-label="Select device"
						className="text-white/90 transition-opacity hover:opacity-100"
						title="Select device"
						type="button"
					>
						<svg
							aria-hidden="true"
							className="size-5"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<rect height="16" rx="2" width="10" x="7" y="4" />
							<path d="M11 17h2" strokeLinecap="round" />
						</svg>
					</button>
					<button
						aria-label="Select build"
						className="text-white/90 transition-opacity hover:opacity-100"
						title="Select build"
						type="button"
					>
						<svg
							aria-hidden="true"
							className="size-5"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<path
								d="M14.7 6.3a4.5 4.5 0 0 0-6.4 6.4L4 17v3h3l4.3-4.3a4.5 4.5 0 0 0 6.4-6.4Z"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
					<button
						aria-label="Export results"
						className="text-white/90 transition-opacity hover:opacity-100"
						title="Export results"
						type="button"
					>
						<svg
							aria-hidden="true"
							className="size-5"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<path
								d="M12 3v12M8 11l4 4 4-4M5 19h14"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</button>
				</div>
				<button
					aria-label="Run tests"
					className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-float transition-transform hover:scale-105"
					title="Run tests"
					type="button"
				>
					<svg aria-hidden="true" className="size-6" fill="currentColor" viewBox="0 0 24 24">
						<path d="M8 5.5v13l11-6.5L8 5.5Z" />
					</svg>
				</button>
			</div>
		</aside>
	);
}
