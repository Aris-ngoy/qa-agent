import { useAppSelectionSync } from "@/features/apps/hooks/use-apps";

/** Mount once at the app root so the selected app always exists in the catalog. */
export function AppSelectionSync(): null {
	useAppSelectionSync();
	return null;
}
