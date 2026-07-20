import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";

export type Application = {
	id: string;
	name: string;
};

type AppsContextValue = {
	apps: Application[];
	addApp: (name: string) => Application;
	hasApps: boolean;
};

const AppsContext = createContext<AppsContextValue | null>(null);

function createId(): string {
	return `app_${crypto.randomUUID()}`;
}

export function AppsProvider({ children }: { children: ReactNode }) {
	const [apps, setApps] = useState<Application[]>([]);

	const addApp = useCallback((name: string) => {
		const trimmed = name.trim();
		if (!trimmed) {
			throw new Error("Application name is required");
		}
		const app: Application = { id: createId(), name: trimmed };
		setApps((current) => [...current, app]);
		return app;
	}, []);

	const value = useMemo(
		() => ({
			apps,
			addApp,
			hasApps: apps.length > 0,
		}),
		[apps, addApp],
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
