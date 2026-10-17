import {
	clearSelectedCases,
	selectedCaseIds$,
	setSelectedCases,
	toggleCase,
} from "@/features/test-cases/data/state/case-selection";
import { useValue } from "@legendapp/state/react";

export function useTestCaseSelection() {
	const selectedCaseIds = useValue(selectedCaseIds$);
	return {
		selectedCaseIds,
		toggle: toggleCase,
		setSelected: setSelectedCases,
		clear: clearSelectedCases,
		isSelected: (caseId: string) => selectedCaseIds.includes(caseId),
	};
}
