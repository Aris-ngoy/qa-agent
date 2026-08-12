import { RootLayout } from "@/app/root-layout";
import { ConfigurationPage } from "@/features/apps/configuration-page";
import { WelcomePage } from "@/features/apps/welcome-page";
import { InspectorPage } from "@/features/inspector/inspector-page";
import { RunDetailPage } from "@/features/runs/detail-page";
import { RunsListPage } from "@/features/runs/list-page";
import { SettingsPage } from "@/features/settings/settings-page";
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

const runsListRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/runs",
	component: RunsListPage,
});

const runDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/runs/$runId",
	component: RunDetailPage,
});

const inspectorRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/inspector",
	component: InspectorPage,
});

const configurationRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/configuration",
	component: ConfigurationPage,
});

const settingsRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings",
	validateSearch: (search: Record<string, unknown>): { section?: string } => ({
		section: typeof search.section === "string" ? search.section : undefined,
	}),
	component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
	indexRoute,
	testCasesRoute,
	testCaseDetailRoute,
	runsListRoute,
	runDetailRoute,
	inspectorRoute,
	configurationRoute,
	settingsRoute,
]);
