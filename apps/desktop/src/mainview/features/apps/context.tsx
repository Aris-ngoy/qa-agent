import { getRunnerClient } from "@/app/runner-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogApp, UpdateAppRequest } from "@yoqa/runner-client";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

export type AppiumCapability = {
	id: string;
	key: string;
	value: string;
};

export type Application = {
	id: string;
	name: string;
	context: string;
	iosBundleId: string;
	iosAppStoreId: string;
	androidApplicationId: string;
	capabilities: AppiumCapability[];
};

export type ApplicationUpdates = Partial<
	Pick<
		Application,
		"name" | "context" | "iosBundleId" | "iosAppStoreId" | "androidApplicationId" | "capabilities"
	>
>;

type AppsContextValue = {
	apps: Application[];
	selectedApp: Application | null;
	isLoading: boolean;
	addApp: (name: string) => Promise<Application>;
	updateApp: (id: string, updates: ApplicationUpdates) => Promise<Application>;
	deleteApp: (id: string) => Promise<void>;
	selectApp: (id: string) => void;
	hasApps: boolean;
};

const AppsContext = createContext<AppsContextValue | null>(null);

const SELECTED_APP_KEY = "yoqa.selectedAppId";
export const APPS_QUERY_KEY = ["catalog", "apps"] as const;

function mapCatalogApp(app: CatalogApp): Application {
	return {
		id: app.id,
		name: app.name,
		context: app.context,
		iosBundleId: app.iosBundleId,
		iosAppStoreId: app.iosAppStoreId,
		androidApplicationId: app.androidApplicationId,
		capabilities: app.capabilities.map((cap) => ({ ...cap })),
	};
}

function readStoredSelectedAppId(): string | null {
	try {
		return localStorage.getItem(SELECTED_APP_KEY);
	} catch {
		return null;
	}
}

function writeStoredSelectedAppId(id: string | null): void {
	try {
		if (id) {
			localStorage.setItem(SELECTED_APP_KEY, id);
		} else {
			localStorage.removeItem(SELECTED_APP_KEY);
		}
	} catch {
		// ignore storage failures in restricted webviews
	}
}

export function AppsProvider({ children }: { children: ReactNode }) {
	const queryClient = useQueryClient();
	const [selectedAppId, setSelectedAppId] = useState<string | null>(() =>
		readStoredSelectedAppId(),
	);

	const appsQuery = useQuery({
		queryKey: APPS_QUERY_KEY,
		queryFn: async () => {
			const client = await getRunnerClient();
			const apps = await client.listApps();
			return apps.map(mapCatalogApp);
		},
	});

	const apps = appsQuery.data ?? [];

	useEffect(() => {
		if (!appsQuery.isSuccess) return;
		if (apps.length === 0) {
			if (selectedAppId !== null) {
				setSelectedAppId(null);
				writeStoredSelectedAppId(null);
			}
			return;
		}
		const stillExists = selectedAppId !== null && apps.some((app) => app.id === selectedAppId);
		if (!stillExists) {
			const nextId = apps[0]?.id ?? null;
			setSelectedAppId(nextId);
			writeStoredSelectedAppId(nextId);
		}
	}, [apps, appsQuery.isSuccess, selectedAppId]);

	const createMutation = useMutation({
		mutationFn: async (name: string) => {
			const client = await getRunnerClient();
			return mapCatalogApp(await client.createApp({ name }));
		},
		onSuccess: (created) => {
			queryClient.setQueryData<Application[]>(APPS_QUERY_KEY, (current) =>
				current ? [...current, created] : [created],
			);
			setSelectedAppId(created.id);
			writeStoredSelectedAppId(created.id);
		},
	});

	const updateMutation = useMutation({
		mutationFn: async ({ id, updates }: { id: string; updates: ApplicationUpdates }) => {
			const client = await getRunnerClient();
			const body: UpdateAppRequest = { ...updates };
			return mapCatalogApp(await client.updateApp(id, body));
		},
		onSuccess: (updated) => {
			queryClient.setQueryData<Application[]>(APPS_QUERY_KEY, (current) =>
				current ? current.map((app) => (app.id === updated.id ? updated : app)) : [updated],
			);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async (id: string) => {
			const client = await getRunnerClient();
			await client.deleteApp(id);
			return id;
		},
		onSuccess: (deletedId) => {
			queryClient.setQueryData<Application[]>(APPS_QUERY_KEY, (current) => {
				const next = (current ?? []).filter((app) => app.id !== deletedId);
				const nextSelected = selectedAppId === deletedId ? (next[0]?.id ?? null) : selectedAppId;
				setSelectedAppId(nextSelected);
				writeStoredSelectedAppId(nextSelected);
				return next;
			});
			void queryClient.removeQueries({ queryKey: ["catalog", "cases", deletedId] });
			void queryClient.removeQueries({ queryKey: ["catalog", "case"] });
			void queryClient.invalidateQueries({ queryKey: ["catalog", "cases"] });
		},
	});

	const addApp = useCallback(
		async (name: string) => createMutation.mutateAsync(name),
		[createMutation],
	);

	const updateApp = useCallback(
		async (id: string, updates: ApplicationUpdates) => updateMutation.mutateAsync({ id, updates }),
		[updateMutation],
	);

	const deleteApp = useCallback(
		async (id: string) => {
			await deleteMutation.mutateAsync(id);
		},
		[deleteMutation],
	);

	const selectApp = useCallback((id: string) => {
		setSelectedAppId(id);
		writeStoredSelectedAppId(id);
	}, []);

	const selectedApp = useMemo(
		() => apps.find((app) => app.id === selectedAppId) ?? null,
		[apps, selectedAppId],
	);

	const value = useMemo(
		() => ({
			apps,
			selectedApp,
			isLoading: appsQuery.isLoading,
			addApp,
			updateApp,
			deleteApp,
			selectApp,
			hasApps: apps.length > 0,
		}),
		[apps, selectedApp, appsQuery.isLoading, addApp, updateApp, deleteApp, selectApp],
	);

	return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}

export function useApps(): AppsContextValue {
	const ctx = useContext(AppsContext);
	if (!ctx) {
		throw new Error("useApps must be used within AppsProvider");
	}
	return ctx;
}
