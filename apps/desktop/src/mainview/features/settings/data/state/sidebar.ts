import {
	readSidebarCollapsed,
	writeSidebarCollapsed,
} from "@/features/settings/utils/ui-preferences";

type SidebarStorage = Parameters<typeof readSidebarCollapsed>[0];

/** Whether the side menu is collapsed to its icon rail; persisted so it survives relaunch. */
export function createSidebarStore(storage?: SidebarStorage) {
	const args: [SidebarStorage] | [] = storage === undefined ? [] : [storage];
	let collapsed = readSidebarCollapsed(...args);
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
			writeSidebarCollapsed(collapsed, ...args);
			for (const listener of listeners) listener();
		},
	};
}

export const sidebarStore = createSidebarStore();
