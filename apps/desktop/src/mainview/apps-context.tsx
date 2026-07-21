import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

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
	addApp: (name: string) => Application;
	updateApp: (id: string, updates: ApplicationUpdates) => Application;
	deleteApp: (id: string) => void;
	selectApp: (id: string) => void;
	hasApps: boolean;
};

const AppsContext = createContext<AppsContextValue | null>(null);

function createId(): string {
	return `app_${crypto.randomUUID()}`;
}

export function AppsProvider({ children }: { children: ReactNode }) {
	const [apps, setApps] = useState<Application[]>([]);
	const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

	const addApp = useCallback((name: string) => {
		const trimmed = name.trim();
		if (!trimmed) {
			throw new Error("Application name is required");
		}
		const app: Application = {
			id: createId(),
			name: trimmed,
			context: "",
			iosBundleId: "",
			iosAppStoreId: "",
			androidApplicationId: "",
			capabilities: [],
		};
		setApps((current) => [...current, app]);
		setSelectedAppId(app.id);
		return app;
	}, []);

	const updateApp = useCallback((id: string, updates: ApplicationUpdates) => {
		let updated: Application | undefined;
		setApps((current) =>
			current.map((app) => {
				if (app.id !== id) return app;
				const nextName = updates.name !== undefined ? updates.name.trim() : app.name;
				if (!nextName) {
					throw new Error("Application name is required");
				}
				updated = {
					...app,
					...updates,
					name: nextName,
				};
				return updated;
			}),
		);
		if (!updated) {
			throw new Error("Application not found");
		}
		return updated;
	}, []);

	const deleteApp = useCallback((id: string) => {
		setApps((current) => {
			const next = current.filter((app) => app.id !== id);
			setSelectedAppId((selected) => {
				if (selected !== id) return selected;
				return next[0]?.id ?? null;
			});
			return next;
		});
	}, []);

	const selectApp = useCallback((id: string) => {
		setSelectedAppId(id);
	}, []);

	const selectedApp = useMemo(
		() => apps.find((app) => app.id === selectedAppId) ?? null,
		[apps, selectedAppId],
	);

	const value = useMemo(
		() => ({
			apps,
			selectedApp,
			addApp,
			updateApp,
			deleteApp,
			selectApp,
			hasApps: apps.length > 0,
		}),
		[apps, selectedApp, addApp, updateApp, deleteApp, selectApp],
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
