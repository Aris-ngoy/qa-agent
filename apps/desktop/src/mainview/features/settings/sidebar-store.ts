import { readSidebarCollapsed, writeSidebarCollapsed } from "./ui-preferences";

type SidebarStorage = Parameters<typeof readSidebarCollapsed>[0];

/** Whether the side menu is collapsed to its icon rail; persisted so it survives relaunch. */
export function createSidebarStore(storage?: SidebarStorage) {
	let collapsed = storage === undefined ? readSidebarCollapsed() : readSidebarCollapsed(storage);
	const listeners = new Set<() => void>();

	return {
		get: () => collapsed,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		toggle() {
			collapsed = !collapsed;
			if (storage === undefined) writeSidebarCollapsed(collapsed);
			else writeSidebarCollapsed(collapsed, storage);
			for (const listener of listeners) listener();
		},
	};
}

export const sidebarStore = createSidebarStore();
