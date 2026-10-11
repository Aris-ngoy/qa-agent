export type InspectorPageState = {
	visible: boolean;
};

export function initialPageState(): InspectorPageState {
	return {
		visible: typeof document === "undefined" ? true : document.visibilityState === "visible",
	};
}
