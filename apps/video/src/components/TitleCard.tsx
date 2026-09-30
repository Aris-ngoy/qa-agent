import { loadFont } from "@remotion/google-fonts/Inter";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { ink, lavender, mist } from "../theme";
import { YoqaMark } from "./YoqaMark";

const { fontFamily } = loadFont("normal", {
	weights: ["500", "600"],
	subsets: ["latin"],
});

type TitleCardProps = {
	kicker?: string;
	title: string;
	subtitle?: string;
	light?: boolean;
};

export function TitleCard({ kicker, title, subtitle, light = false }: TitleCardProps) {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const enter = spring({ frame, fps, config: { damping: 18, mass: 0.8 } });
	const rise = interpolate(enter, [0, 1], [28, 0]);
	const color = light ? ink : lavender;
	const subColor = light ? mist : "#8a8792";

	return (
		<AbsoluteFill
			style={{
				backgroundColor: light ? "#eef0f8" : ink,
				alignItems: "center",
				justifyContent: "center",
				fontFamily,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					opacity: enter,
					transform: `translateY(${rise}px)`,
					padding: 80,
					textAlign: "center",
				}}
			>
				<YoqaMark size={light ? 120 : 168} />
				{kicker ? (
					<p
						style={{
							margin: "28px 0 0",
							letterSpacing: 3,
							textTransform: "uppercase",
							fontSize: 22,
							fontWeight: 600,
							color: subColor,
						}}
					>
						{kicker}
					</p>
				) : null}
				<h1
					style={{
						margin: "18px 0 0",
						fontSize: 72,
						lineHeight: 1.05,
						fontWeight: 600,
						color,
						maxWidth: 1400,
					}}
				>
					{title}
				</h1>
				{subtitle ? (
					<p
						style={{
							margin: "22px 0 0",
							fontSize: 32,
							lineHeight: 1.35,
							fontWeight: 500,
							color: subColor,
							maxWidth: 1100,
						}}
					>
						{subtitle}
					</p>
				) : null}
			</div>
		</AbsoluteFill>
	);
}
