import { createRootRoute, createRoute } from "@tanstack/react-router";
import { HomePage } from "./routes/home";
import { RootLayout } from "./routes/root";

const rootRoute = createRootRoute({
	component: RootLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: HomePage,
});

export const routeTree = rootRoute.addChildren([indexRoute]);
