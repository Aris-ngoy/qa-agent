type YoqaMarkProps = {
	className?: string;
};

/** Lavender Y mark with a bead/chain stroke through the glyph. */
export function YoqaMark({ className }: YoqaMarkProps) {
	return (
		<svg
			aria-label="Yoqa"
			className={className}
			height="120"
			role="img"
			viewBox="0 0 120 120"
			width="120"
		>
			<title>Yoqa</title>
			<path
				d="M30,25 L58,58"
				fill="none"
				stroke="#e3dbf7"
				stroke-width="26"
				stroke-linecap="round"
			/>
			<path
				d="M90,25 L58,58"
				fill="none"
				stroke="#e3dbf7"
				stroke-width="26"
				stroke-linecap="round"
			/>
			<path
				d="M58,55 L62,100"
				fill="none"
				stroke="#e3dbf7"
				stroke-width="26"
				stroke-linecap="round"
			/>
			<line x1="35.6" y1="31.6" x2="44" y2="41.5" stroke="#14131c" stroke-width="3" />
			<line x1="44" y1="41.5" x2="52.4" y2="51.6" stroke="#14131c" stroke-width="3" />
			<line x1="52.4" y1="51.6" x2="58" y2="58" stroke="#14131c" stroke-width="3" />
			<line x1="83.6" y1="31.6" x2="74" y2="41.5" stroke="#14131c" stroke-width="3" />
			<line x1="74" y1="41.5" x2="65.6" y2="51.6" stroke="#14131c" stroke-width="3" />
			<line x1="65.6" y1="51.6" x2="58" y2="58" stroke="#14131c" stroke-width="3" />
			<line x1="58" y1="58" x2="59.2" y2="68.5" stroke="#14131c" stroke-width="3" />
			<line x1="59.2" y1="68.5" x2="60.8" y2="86.5" stroke="#14131c" stroke-width="3" />
			<circle cx="35.6" cy="31.6" r="5" fill="#14131c" />
			<circle cx="44" cy="41.5" r="5" fill="#14131c" />
			<circle cx="52.4" cy="51.6" r="5" fill="#14131c" />
			<circle cx="83.6" cy="31.6" r="5" fill="#14131c" />
			<circle cx="74" cy="41.5" r="5" fill="#14131c" />
			<circle cx="65.6" cy="51.6" r="5" fill="#14131c" />
			<circle cx="58" cy="58" r="6" fill="#14131c" />
			<circle cx="59.2" cy="68.5" r="5" fill="#14131c" />
			<circle cx="60.8" cy="86.5" r="5" fill="#14131c" />
		</svg>
	);
}
