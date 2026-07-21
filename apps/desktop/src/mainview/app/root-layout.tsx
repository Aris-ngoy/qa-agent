import { AppShell } from "@/app/shell";
import { useApps } from "@/features/apps/context";
import { WelcomePage } from "@/features/apps/welcome-page";
import { Outlet, useRouterState } from "@tanstack/react-router";

export function RootLayout() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const { selectedApp } = useApps();
	const showWelcome = !selectedApp;

	return (
		<AppShell activePath={showWelcome ? "/" : pathname}>
			{showWelcome ? <WelcomePage /> : <Outlet />}
		</AppShell>
	);
}
