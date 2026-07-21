import { Outlet, useRouterState } from "@tanstack/react-router";
import { useApps } from "../apps-context";
import { AppShell } from "../components/app-shell";
import { WelcomePage } from "./welcome";

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
