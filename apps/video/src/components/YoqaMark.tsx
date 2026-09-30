type YoqaMarkProps = {
	size?: number;
};

/** Lavender Y mark with a bead/chain stroke through the glyph. */
export function YoqaMark({ size = 180 }: YoqaMarkProps) {
	return (
		<svg aria-label="Yoqa" height={size} role="img" viewBox="0 0 120 120" width={size}>
			<title>Yoqa</title>
			<path
				d="M30,25 L58,58"
				fill="none"
				stroke="#e3dbf7"
				strokeLinecap="round"
				strokeWidth="26"
			/>
			<path
				d="M90,25 L58,58"
				fill="none"
				stroke="#e3dbf7"
				strokeLinecap="round"
				strokeWidth="26"
			/>
			<path
				d="M58,55 L62,100"
				fill="none"
				stroke="#e3dbf7"
				strokeLinecap="round"
				strokeWidth="26"
			/>
			<line stroke="#14131c" strokeWidth="3" x1="35.6" x2="44" y1="31.6" y2="41.5" />
			<line stroke="#14131c" strokeWidth="3" x1="44" x2="52.4" y1="41.5" y2="51.6" />
			<line stroke="#14131c" strokeWidth="3" x1="52.4" x2="58" y1="51.6" y2="58" />
			<line stroke="#14131c" strokeWidth="3" x1="83.6" x2="74" y1="31.6" y2="41.5" />
			<line stroke="#14131c" strokeWidth="3" x1="74" x2="65.6" y1="41.5" y2="51.6" />
			<line stroke="#14131c" strokeWidth="3" x1="65.6" x2="58" y1="51.6" y2="58" />
			<line stroke="#14131c" strokeWidth="3" x1="58" x2="59.2" y1="58" y2="68.5" />
			<line stroke="#14131c" strokeWidth="3" x1="59.2" x2="60.8" y1="68.5" y2="86.5" />
			<circle cx="35.6" cy="31.6" fill="#14131c" r="5" />
			<circle cx="44" cy="41.5" fill="#14131c" r="5" />
			<circle cx="52.4" cy="51.6" fill="#14131c" r="5" />
			<circle cx="83.6" cy="31.6" fill="#14131c" r="5" />
			<circle cx="74" cy="41.5" fill="#14131c" r="5" />
			<circle cx="65.6" cy="51.6" fill="#14131c" r="5" />
			<circle cx="58" cy="58" fill="#14131c" r="6" />
			<circle cx="59.2" cy="68.5" fill="#14131c" r="5" />
			<circle cx="60.8" cy="86.5" fill="#14131c" r="5" />
		</svg>
	);
}
