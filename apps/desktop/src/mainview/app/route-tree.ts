import { RootLayout } from "@/app/root-layout";
import { ConfigurationPage } from "@/features/apps/configuration-page";
import { WelcomePage } from "@/features/apps/welcome-page";
import { StatusPage } from "@/features/status/status-page";
import { TestCaseDetailPage } from "@/features/test-cases/detail-page";
import { TestCasesPage } from "@/features/test-cases/list-page";
import { createRootRoute, createRoute } from "@tanstack/react-router";

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

const configurationRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/configuration",
	component: ConfigurationPage,
});

export const routeTree = rootRoute.addChildren([
	indexRoute,
	statusRoute,
	testCasesRoute,
	testCaseDetailRoute,
	configurationRoute,
]);
