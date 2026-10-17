import { prefersReducedMotion$ } from "@/app/motion/reduced-motion";
import { useValue } from "@legendapp/state/react";

export function useReducedMotion(): boolean {
	return useValue(prefersReducedMotion$);
}
