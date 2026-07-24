import { initDesktopRpc } from "@/app/desktop-rpc";
import { viewTransitionTypes } from "@/app/motion/route-rank";
import { routeTree } from "@/app/route-tree";
import { AppsProvider } from "@/features/apps/context";
import { ActiveRunProvider } from "@/features/runs/active-run-context";
import { BootGate } from "@/features/splash/boot-gate";
import { TestCaseSelectionProvider } from "@/features/test-cases/selection-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

initDesktopRpc();

const queryClient = new QueryClient();
const router = createRouter({
	routeTree,
	defaultViewTransition: {
		types: ({ fromLocation, toLocation }) =>
			viewTransitionTypes({
				fromPathname: fromLocation?.pathname,
				toPathname: toLocation.pathname,
			}),
	},
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById("root");
if (!rootElement) {
	throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<AppsProvider>
				<TestCaseSelectionProvider>
					<ActiveRunProvider>
						<BootGate>
							<RouterProvider router={router} />
						</BootGate>
					</ActiveRunProvider>
				</TestCaseSelectionProvider>
			</AppsProvider>
		</QueryClientProvider>
	</StrictMode>,
);
