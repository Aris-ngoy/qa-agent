import { Composition } from "remotion";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./theme";
import { YoqaWalkthrough } from "./YoqaWalkthrough";

export function RemotionRoot() {
	return (
		<Composition
			component={YoqaWalkthrough}
			durationInFrames={TOTAL_FRAMES}
			fps={FPS}
			height={HEIGHT}
			id="YoqaWalkthrough"
			width={WIDTH}
		/>
	);
}
