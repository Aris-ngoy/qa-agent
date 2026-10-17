import { startViewTransition } from "@/app/motion/start-view-transition";
import { AppShell } from "@/app/shell";
import { WelcomePage } from "@/features/apps/components/welcome-page";
import { useApps } from "@/features/apps/hooks/use-apps";
import { useObservable, useValue } from "@legendapp/state/react";
import { Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

export function RootLayout() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const { selectedApp } = useApps();
	const wantsWelcome = !selectedApp;
	const showWelcome$ = useObservable(wantsWelcome);
	const showWelcome = useValue(showWelcome$);
	const isFirstRender = useRef(true);

	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			showWelcome$.set(wantsWelcome);
			return;
		}

		if (wantsWelcome === showWelcome) return;

		startViewTransition(() => {
			flushSync(() => {
				showWelcome$.set(wantsWelcome);
			});
		});
	}, [wantsWelcome, showWelcome, showWelcome$]);

	return (
		<AppShell activePath={showWelcome ? "/" : pathname}>
			{showWelcome ? <WelcomePage /> : <Outlet />}
		</AppShell>
	);
}
