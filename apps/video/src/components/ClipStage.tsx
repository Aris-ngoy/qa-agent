import type { ReactNode } from "react";
import { AbsoluteFill, OffthreadVideo, staticFile } from "remotion";
import { canvasBottom, canvasMid, canvasTop } from "../theme";

const stageBackground = `radial-gradient(ellipse 80% 60% at 20% 10%, rgba(201,184,232,0.45), transparent 55%), radial-gradient(ellipse 70% 50% at 85% 20%, rgba(168,213,196,0.35), transparent 50%), linear-gradient(160deg, ${canvasTop} 0%, ${canvasMid} 45%, ${canvasBottom} 100%)`;

type ClipStageProps = {
	file: string;
	children?: ReactNode;
};

export function ClipStage({ file, children }: ClipStageProps) {
	return (
		<AbsoluteFill style={{ background: stageBackground }}>
			<div
				style={{
					position: "absolute",
					left: 72,
					right: 72,
					top: 56,
					bottom: 128,
					borderRadius: 20,
					overflow: "hidden",
					boxShadow: "0 28px 70px rgba(20,19,28,0.22)",
					background: "#fff",
				}}
			>
				<OffthreadVideo
					src={staticFile(`captures/${file}`)}
					style={{ width: "100%", height: "100%", objectFit: "cover" }}
				/>
			</div>
			{children}
		</AbsoluteFill>
	);
}
