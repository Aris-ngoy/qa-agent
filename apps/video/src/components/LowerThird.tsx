import { loadFont } from "@remotion/google-fonts/Inter";
import { interpolate, useCurrentFrame } from "remotion";
import { ink, lavender } from "../theme";

const { fontFamily } = loadFont("normal", {
	weights: ["500", "600"],
	subsets: ["latin"],
});

type LowerThirdProps = {
	chapter: string;
	label: string;
};

export function LowerThird({ chapter, label }: LowerThirdProps) {
	const frame = useCurrentFrame();
	const opacity = interpolate(frame, [0, 12], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const x = interpolate(frame, [0, 12], [-16, 0], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	return (
		<div
			style={{
				position: "absolute",
				left: 56,
				bottom: 48,
				opacity,
				transform: `translateX(${x}px)`,
				display: "flex",
				alignItems: "center",
				gap: 16,
				fontFamily,
			}}
		>
			<span
				style={{
					background: lavender,
					color: ink,
					fontWeight: 600,
					fontSize: 22,
					letterSpacing: 1.5,
					padding: "10px 16px",
					borderRadius: 999,
				}}
			>
				{chapter}
			</span>
			<span
				style={{
					color: "#f4f1fb",
					fontWeight: 500,
					fontSize: 28,
					textShadow: "0 2px 16px rgba(20,19,28,0.55)",
				}}
			>
				{label}
			</span>
		</div>
	);
}
