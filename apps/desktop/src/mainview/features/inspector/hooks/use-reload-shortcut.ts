import { isReloadShortcut, isTypingTarget } from "@/features/inspector/utils/reload-shortcut";
import { useEffect, useRef } from "react";

/**
 * F5 and ⌘R reload the Browser device's page while `enabled` and nothing is being typed.
 * Otherwise the keys are left alone.
 */
export function useReloadShortcut(enabled: boolean, onReload: () => void): void {
	const latest = useRef({ enabled, onReload });
	latest.current = { enabled, onReload };

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!latest.current.enabled || event.repeat || !isReloadShortcut(event)) return;
			if (isTypingTarget(event.target)) return;
			event.preventDefault();
			latest.current.onReload();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);
}
