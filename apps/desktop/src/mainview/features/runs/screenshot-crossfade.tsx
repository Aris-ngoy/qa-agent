import { useEffect, useState } from "react";

const IMAGE_CLASS = "h-full w-full object-contain";

/** Matches `--motion-slow`; the swap only drops the old image after the fade has run. */
const SWAP_MS = 400;

type Incoming = { src: string; loaded: boolean };

/**
 * Shows one device screenshot. When `src` changes, the previous image stays until the new one has
 * loaded, then the new one fades in over it, so there is no empty gap between steps.
 */
export function ScreenshotCrossfade({
	src,
	alt,
	onNaturalSize,
}: {
	src: string;
	alt: string;
	/** Reports each screenshot's pixel size once it loads, so the frame can take its shape. */
	onNaturalSize?: (size: { width: number; height: number }) => void;
}) {
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
		<div className="motion-fade-in relative h-full min-h-0 w-full">
			<img
				alt={alt}
				className={IMAGE_CLASS}
				onLoad={(event) =>
					onNaturalSize?.({
						width: event.currentTarget.naturalWidth,
						height: event.currentTarget.naturalHeight,
					})
				}
				src={base}
			/>
			{incoming && incoming.src !== base ? (
				<img
					alt={alt}
					className={[
						IMAGE_CLASS,
						"pointer-events-none absolute inset-0 transition-opacity duration-[var(--motion-slow)]",
						incoming.loaded ? "opacity-100" : "opacity-0",
					].join(" ")}
					key={incoming.src}
					onLoad={(event) => {
						onNaturalSize?.({
							width: event.currentTarget.naturalWidth,
							height: event.currentTarget.naturalHeight,
						});
						setIncoming((current) =>
							current && current.src === incoming.src ? { ...current, loaded: true } : current,
						);
					}}
					src={incoming.src}
				/>
			) : null}
		</div>
	);
}
