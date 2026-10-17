import {
	readSidebarCollapsed,
	writeSidebarCollapsed,
} from "@/features/settings/utils/ui-preferences";
import { observable } from "@legendapp/state";

type SidebarStorage = Parameters<typeof readSidebarCollapsed>[0];

/** Whether the side menu is collapsed to its icon rail; persisted so it survives relaunch. */
export function createSidebarStore(storage?: SidebarStorage) {
	const args: [SidebarStorage] | [] = storage === undefined ? [] : [storage];
	const collapsed$ = observable(readSidebarCollapsed(...args));

	return {
		collapsed$,
		toggle() {
			const next = !collapsed$.peek();
			collapsed$.set(next);
			writeSidebarCollapsed(next, ...args);
		},
	};
}

export const sidebarStore = createSidebarStore();
