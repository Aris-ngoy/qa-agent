import { createRootRoute, createRoute } from "@tanstack/react-router";
import { RootLayout } from "./routes/root";
import { StatusPage } from "./routes/status";
import { TestCasesPage } from "./routes/test-cases";

const rootRoute = createRootRoute({
	component: RootLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: StatusPage,
});

const testCasesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/test-cases",
	component: TestCasesPage,
});

export const routeTree = rootRoute.addChildren([indexRoute, testCasesRoute]);
