import { createRootRoute, createRoute } from "@tanstack/react-router";
import { RootLayout } from "./routes/root";
import { StatusPage } from "./routes/status";
import { TestCaseDetailPage } from "./routes/test-case-detail";
import { TestCasesPage } from "./routes/test-cases";
import { WelcomePage } from "./routes/welcome";

const rootRoute = createRootRoute({
	component: RootLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: WelcomePage,
});

const statusRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/status",
	component: StatusPage,
});

const testCasesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/test-cases",
	component: TestCasesPage,
});

const testCaseDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/test-cases/$caseId",
	component: TestCaseDetailPage,
});

export const routeTree = rootRoute.addChildren([
	indexRoute,
	statusRoute,
	testCasesRoute,
	testCaseDetailRoute,
]);
