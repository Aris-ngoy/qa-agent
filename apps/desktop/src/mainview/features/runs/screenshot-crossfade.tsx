import { useEffect, useState } from "react";

const IMAGE_CLASS =
	"max-h-[min(70vh,40rem)] w-auto max-w-full rounded-2xl object-contain shadow-card lg:max-h-full";

/** Matches `--motion-slow`; the swap only drops the old image after the fade has run. */
const SWAP_MS = 400;

type Incoming = { src: string; loaded: boolean };

/**
 * Shows one device screenshot. When `src` changes, the previous image stays until the new one has
 * loaded, then the new one fades in over it, so there is no empty gap between steps.
 */
export function ScreenshotCrossfade({ src, alt }: { src: string; alt: string }) {
	const [base, setBase] = useState(src);
	const [incoming, setIncoming] = useState<Incoming | null>(null);

	useEffect(() => {
		setIncoming(src === base ? null : { src, loaded: false });
	}, [src, base]);

	useEffect(() => {
		if (!incoming?.loaded) return;
		const timer = setTimeout(() => setBase(incoming.src), SWAP_MS);
		return () => clearTimeout(timer);
	}, [incoming]);

	return (
		<div className="motion-fade-in relative flex h-full min-h-0 w-full items-start justify-center">
			<img alt={alt} className={IMAGE_CLASS} src={base} />
			{incoming && incoming.src !== base ? (
				<img
					alt={alt}
					className={[
						IMAGE_CLASS,
						"pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 transition-opacity duration-[var(--motion-slow)]",
						incoming.loaded ? "opacity-100" : "opacity-0",
					].join(" ")}
					key={incoming.src}
					onLoad={() =>
						setIncoming((current) =>
							current && current.src === incoming.src ? { ...current, loaded: true } : current,
						)
					}
					src={incoming.src}
				/>
			) : null}
		</div>
	);
}
