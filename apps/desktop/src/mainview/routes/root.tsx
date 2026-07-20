import { Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell } from "../components/app-shell";

export function RootLayout() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	return (
		<AppShell activePath={pathname}>
			<Outlet />
		</AppShell>
	);
}
