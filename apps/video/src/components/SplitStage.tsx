import { loadFont } from "@remotion/google-fonts/Inter";
import { AbsoluteFill, OffthreadVideo, staticFile, useCurrentFrame } from "remotion";
import { canvasBottom, canvasMid, canvasTop, ink, lavender } from "../theme";

const { fontFamily } = loadFont("normal", {
	weights: ["500", "600"],
	subsets: ["latin"],
});

const stageBackground = `radial-gradient(ellipse 80% 60% at 20% 10%, rgba(201,184,232,0.45), transparent 55%), radial-gradient(ellipse 70% 50% at 85% 20%, rgba(168,213,196,0.35), transparent 50%), linear-gradient(160deg, ${canvasTop} 0%, ${canvasMid} 45%, ${canvasBottom} 100%)`;

const LOOP = [
	{ title: "Perceive", body: "A screenshot of what is on the device." },
	{ title: "Decide", body: "The next step toward the test goal." },
	{ title: "Act", body: "Tap, type, and check the result." },
] as const;

type SplitStageProps = {
	desktopFile: string;
	simulatorFile: string;
};

export function SplitStage({ desktopFile, simulatorFile }: SplitStageProps) {
	const frame = useCurrentFrame();
	const step = LOOP[Math.floor(frame / (8 * 30)) % LOOP.length] ?? LOOP[0];

	return (
		<AbsoluteFill style={{ background: stageBackground, fontFamily }}>
			<div
				style={{
					position: "absolute",
					left: 48,
					top: 48,
					bottom: 48,
					width: 1180,
					borderRadius: 20,
					overflow: "hidden",
					boxShadow: "0 28px 70px rgba(20,19,28,0.22)",
					background: "#fff",
				}}
			>
				<OffthreadVideo
					src={staticFile(`captures/${desktopFile}`)}
					style={{ width: "100%", height: "100%", objectFit: "cover" }}
				/>
			</div>
			<div
				style={{
					position: "absolute",
					right: 56,
					top: 36,
					width: 390,
					height: 820,
					borderRadius: 46,
					background: ink,
					padding: 14,
					boxShadow: "0 30px 70px rgba(20,19,28,0.28)",
				}}
			>
				<div
					style={{
						width: "100%",
						height: "100%",
						borderRadius: 34,
						overflow: "hidden",
						background: "#000",
					}}
				>
					<OffthreadVideo
						src={staticFile(`captures/${simulatorFile}`)}
						style={{ width: "100%", height: "100%", objectFit: "cover" }}
					/>
				</div>
			</div>
			<div
				style={{
					position: "absolute",
					left: 72,
					bottom: 72,
					background: "rgba(20,19,28,0.88)",
					color: lavender,
					borderRadius: 16,
					padding: "16px 22px",
					maxWidth: 520,
				}}
			>
				<p style={{ margin: 0, fontSize: 14, letterSpacing: 2, fontWeight: 600, color: "#b7a8de" }}>
					{step.title.toUpperCase()}
				</p>
				<p style={{ margin: "6px 0 0", fontSize: 26, fontWeight: 500 }}>{step.body}</p>
			</div>
		</AbsoluteFill>
	);
}
