import {
	type Application,
	type ApplicationUpdates,
	createApp,
	deleteApp,
	listApps,
	updateApp,
} from "@/features/apps/data/api/apps";
import { selectAppId, selectedAppId$ } from "@/features/apps/data/state/selected-app";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export const APPS_QUERY_KEY = ["catalog", "apps"] as const;

export function useAppsQuery() {
	return useQuery({ queryKey: APPS_QUERY_KEY, queryFn: listApps });
}

/** Create an app, add it to the list cache, and select it. */
export function useCreateApp() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: createApp,
		onSuccess: (created) => {
			queryClient.setQueryData<Application[]>(APPS_QUERY_KEY, (current) =>
				current ? [...current, created] : [created],
			);
			selectAppId(created.id);
		},
	});
}

export function useUpdateApp() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ id, updates }: { id: string; updates: ApplicationUpdates }) =>
			updateApp(id, updates),
		onSuccess: (updated) => {
			queryClient.setQueryData<Application[]>(APPS_QUERY_KEY, (current) =>
				current ? current.map((app) => (app.id === updated.id ? updated : app)) : [updated],
			);
		},
	});
}

/** Delete an app and its cached cases; the next app is selected when it was the selected one. */
export function useDeleteApp() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: deleteApp,
		onSuccess: (deletedId) => {
			queryClient.setQueryData<Application[]>(APPS_QUERY_KEY, (current) => {
				const next = (current ?? []).filter((app) => app.id !== deletedId);
				const selected = selectedAppId$.peek();
				selectAppId(selected === deletedId ? (next[0]?.id ?? null) : selected);
				return next;
			});
			void queryClient.removeQueries({ queryKey: ["catalog", "cases", deletedId] });
			void queryClient.removeQueries({ queryKey: ["catalog", "case"] });
			void queryClient.invalidateQueries({ queryKey: ["catalog", "cases"] });
		},
	});
}
