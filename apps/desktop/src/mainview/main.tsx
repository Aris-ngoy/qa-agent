import { initDesktopRpc } from "@/app/desktop-rpc";
import { viewTransitionTypes } from "@/app/motion/route-rank";
import { routeTree } from "@/app/route-tree";
import { AppSelectionSync } from "@/features/apps/components/app-selection-sync";
import { SidebarShortcut } from "@/features/settings/components/sidebar-toggle";
import { ThemeSync } from "@/features/settings/components/theme-sync";
import { BootGate } from "@/features/splash/components/boot-gate";
import { Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./view-transition-types.css";

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
			<ThemeSync />
			<SidebarShortcut />
			<Toast.Provider />
			<AppSelectionSync />
			<BootGate>
				<RouterProvider router={router} />
			</BootGate>
		</QueryClientProvider>
	</StrictMode>,
);
