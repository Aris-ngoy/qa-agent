import { AbsoluteFill, Sequence } from "remotion";
import { ClipStage } from "./components/ClipStage";
import { LowerThird } from "./components/LowerThird";
import { SplitStage } from "./components/SplitStage";
import { TitleCard } from "./components/TitleCard";
import {
	CASE_FRAMES,
	CLI_FRAMES,
	CLOSE_FRAMES,
	DESKTOP_FRAMES,
	OPEN_FRAMES,
	RUN_CARD_FRAMES,
	RUN_SPLIT_FRAMES,
} from "./theme";

export function YoqaWalkthrough() {
	const desktopAt = OPEN_FRAMES;
	const caseAt = desktopAt + DESKTOP_FRAMES;
	const runCardAt = caseAt + CASE_FRAMES;
	const runSplitAt = runCardAt + RUN_CARD_FRAMES;
	const cliAt = runSplitAt + RUN_SPLIT_FRAMES;
	const closeAt = cliAt + CLI_FRAMES;

	return (
		<AbsoluteFill>
			<Sequence durationInFrames={OPEN_FRAMES} from={0}>
				<TitleCard
					subtitle="Local-first agentic mobile QA"
					title="Yoqa"
				/>
			</Sequence>
			<Sequence durationInFrames={DESKTOP_FRAMES} from={desktopAt}>
				<ClipStage file="desktop.mp4">
					<LowerThird chapter="01" label="Add an app" />
				</ClipStage>
			</Sequence>
			<Sequence durationInFrames={CASE_FRAMES} from={caseAt}>
				<ClipStage file="test-case.mp4">
					<LowerThird chapter="02" label="Write the goal" />
				</ClipStage>
			</Sequence>
			<Sequence durationInFrames={RUN_CARD_FRAMES} from={runCardAt}>
				<TitleCard
					kicker="Runs"
					light
					subtitle="A passing AI run can be saved and replayed as a script. This one is that script."
					title="Perceive, decide, act"
				/>
			</Sequence>
			<Sequence durationInFrames={RUN_SPLIT_FRAMES} from={runSplitAt}>
				<SplitStage desktopFile="run-desktop.mp4" simulatorFile="simulator.mp4" />
			</Sequence>
			<Sequence durationInFrames={CLI_FRAMES} from={cliAt}>
				<ClipStage file="cli.mp4">
					<LowerThird chapter="03" label="Same run from the terminal" />
				</ClipStage>
			</Sequence>
			<Sequence durationInFrames={CLOSE_FRAMES} from={closeAt}>
				<TitleCard
					subtitle="yoqa.mintlify.site/docs/quickstart"
					title="Run it locally"
				/>
			</Sequence>
		</AbsoluteFill>
	);
}
