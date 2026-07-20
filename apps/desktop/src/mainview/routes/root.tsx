import { Outlet } from "@tanstack/react-router";

export function RootLayout() {
	return (
		<div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-8 py-10">
			<header className="mb-10">
				<p className="text-3xl font-semibold tracking-tight text-qa-ink">qa-agent</p>
				<p className="mt-2 max-w-xl text-sm text-qa-ink/70">
					Local device QA host — runner health and session status (Phase 1, no login).
				</p>
			</header>
			<main className="flex-1">
				<Outlet />
			</main>
		</div>
	);
}
