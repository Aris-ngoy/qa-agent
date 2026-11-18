import { RootLayout } from "@/app/root-layout";
import { ConfigurationPage } from "@/features/apps/components/configuration-page";
import { WelcomePage } from "@/features/apps/components/welcome-page";
import { AutoPage } from "@/features/auto/components/auto-page";
import { InspectorPage } from "@/features/inspector/components/inspector-page";
import { RunDetailPage } from "@/features/runs/components/run-detail-page";
import { RunsListPage } from "@/features/runs/components/runs-list-page";
import { SettingsPage } from "@/features/settings/components/settings-page";
import { TestCaseDetailPage } from "@/features/test-cases/components/test-case-detail-page";
import { TestCasesPage } from "@/features/test-cases/components/test-cases-page";
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

const autoRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/auto",
	// `chat` opens that Auto chat; without it the App's newest chat opens.
	validateSearch: (search: Record<string, unknown>): { chat?: string } => ({
		chat: typeof search.chat === "string" && search.chat.length > 0 ? search.chat : undefined,
	}),
	component: AutoPage,
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
	autoRoute,
	inspectorRoute,
	configurationRoute,
	settingsRoute,
]);
