import type { Application, ApplicationUpdates } from "@/features/apps/data/api/apps";
import { selectAppId, selectedAppId$ } from "@/features/apps/data/state/selected-app";
import {
	useAppsQuery,
	useCreateApp,
	useDeleteApp,
	useUpdateApp,
} from "@/features/apps/hooks/usequery/use-apps-query";
import { useValue } from "@legendapp/state/react";
import { useEffect } from "react";

/** The catalog's apps, the one selected in the side menu, and the app CRUD the pages use. */
export function useApps() {
	const appsQuery = useAppsQuery();
	const createMutation = useCreateApp();
	const updateMutation = useUpdateApp();
	const deleteMutation = useDeleteApp();
	const selectedAppId = useValue(selectedAppId$);

	const apps = appsQuery.data ?? [];

	return {
		apps,
		selectedApp: apps.find((app) => app.id === selectedAppId) ?? null,
		isLoading: appsQuery.isLoading,
		hasApps: apps.length > 0,
		addApp: (name: string): Promise<Application> => createMutation.mutateAsync(name),
		updateApp: (id: string, updates: ApplicationUpdates): Promise<Application> =>
			updateMutation.mutateAsync({ id, updates }),
		deleteApp: async (id: string): Promise<void> => {
			await deleteMutation.mutateAsync(id);
		},
		selectApp: (id: string) => selectAppId(id),
	};
}

/**
 * Keep the selection on an app that exists: the first app when the stored one is gone, none
 * when the catalog is empty. Mount once at the app root (`AppSelectionSync`).
 */
export function useAppSelectionSync(): void {
	const appsQuery = useAppsQuery();
	const selectedAppId = useValue(selectedAppId$);

	useEffect(() => {
		if (!appsQuery.isSuccess) return;
		const apps = appsQuery.data;
		if (apps.length === 0) {
			if (selectedAppId !== null) selectAppId(null);
			return;
		}
		if (selectedAppId === null || !apps.some((app) => app.id === selectedAppId)) {
			selectAppId(apps[0]?.id ?? null);
		}
	}, [appsQuery.data, appsQuery.isSuccess, selectedAppId]);
}
