import { useApps } from "@/features/apps/context";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

type TestCaseSelectionContextValue = {
	selectedCaseIds: string[];
	toggle: (caseId: string) => void;
	setSelected: (caseIds: string[]) => void;
	clear: () => void;
	isSelected: (caseId: string) => boolean;
};

const TestCaseSelectionContext = createContext<TestCaseSelectionContextValue | null>(null);

export function TestCaseSelectionProvider({ children }: { children: ReactNode }) {
	const { selectedApp } = useApps();
	const selectedAppId = selectedApp?.id ?? null;
	const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([]);

	// Clear selection when switching apps (selectedAppId is the trigger, unused in body).
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on app id change
	useEffect(() => {
		setSelectedCaseIds([]);
	}, [selectedAppId]);

	const toggle = useCallback((caseId: string) => {
		setSelectedCaseIds((current) =>
			current.includes(caseId) ? current.filter((id) => id !== caseId) : [...current, caseId],
		);
	}, []);

	const setSelected = useCallback((caseIds: string[]) => {
		setSelectedCaseIds([...new Set(caseIds)]);
	}, []);

	const clear = useCallback(() => {
		setSelectedCaseIds([]);
	}, []);

	const isSelected = useCallback(
		(caseId: string) => selectedCaseIds.includes(caseId),
		[selectedCaseIds],
	);

	const value = useMemo(
		() => ({ selectedCaseIds, toggle, setSelected, clear, isSelected }),
		[selectedCaseIds, toggle, setSelected, clear, isSelected],
	);

	return (
		<TestCaseSelectionContext.Provider value={value}>{children}</TestCaseSelectionContext.Provider>
	);
}

export function useTestCaseSelection(): TestCaseSelectionContextValue {
	const ctx = useContext(TestCaseSelectionContext);
	if (!ctx) {
		throw new Error("useTestCaseSelection must be used within TestCaseSelectionProvider");
	}
	return ctx;
}
