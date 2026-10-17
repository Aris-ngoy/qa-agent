import { useProviderDriverCatalog } from "@/features/providers/hooks/usequery/use-providers";
import {
	COMING_SOON_DRIVERS,
	type DriverMeta,
	getDriverMeta,
	mergeCatalogWithLocal,
} from "@/features/providers/utils/driver-meta";
import type { ProviderKind } from "@yoqa/runner-client";

/** Active drivers with runner catalog preferred when available. */
export function useActiveDrivers(enabled = true): DriverMeta[] {
	const catalogQuery = useProviderDriverCatalog(enabled);
	return mergeCatalogWithLocal(catalogQuery.data);
}

export function useDriverCards(enabled = true): DriverMeta[] {
	const active = useActiveDrivers(enabled);
	return [...active, ...COMING_SOON_DRIVERS];
}

export function useDriverMeta(kind: ProviderKind, enabled = true): DriverMeta {
	const catalogQuery = useProviderDriverCatalog(enabled);
	return getDriverMeta(kind, catalogQuery.data);
}
