import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
	const [reduced, setReduced] = useState(() => {
		if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
			return false;
		}
		return window.matchMedia(QUERY).matches;
	});

	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const media = window.matchMedia(QUERY);
		const onChange = () => setReduced(media.matches);
		onChange();
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);

	return reduced;
}
