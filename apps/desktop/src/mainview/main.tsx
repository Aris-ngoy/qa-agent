import { initDesktopRpc } from "@/app/desktop-rpc";
import { routeTree } from "@/app/route-tree";
import { AppsProvider } from "@/features/apps/context";
import { BootGate } from "@/features/splash/boot-gate";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

initDesktopRpc();

const queryClient = new QueryClient();
const router = createRouter({ routeTree });

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
				<BootGate>
					<RouterProvider router={router} />
				</BootGate>
			</AppsProvider>
		</QueryClientProvider>
	</StrictMode>,
);
