import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

export type Application = {
	id: string;
	name: string;
};

type AppsContextValue = {
	apps: Application[];
	selectedApp: Application | null;
	addApp: (name: string) => Application;
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
		const app: Application = { id: createId(), name: trimmed };
		setApps((current) => [...current, app]);
		setSelectedAppId(app.id);
		return app;
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
			selectApp,
			hasApps: apps.length > 0,
		}),
		[apps, selectedApp, addApp, selectApp],
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
