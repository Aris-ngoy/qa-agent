import { useYoqaUpdateSync } from "@/features/yoqa-update/hooks/use-yoqa-update-sync";

/** Mount once at the app root so the banner and Settings see every Yoqa update snapshot. */
export function YoqaUpdateSync(): null {
	useYoqaUpdateSync();
	return null;
}
