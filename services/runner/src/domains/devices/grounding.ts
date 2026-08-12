import { z } from "zod";
import { resolveActiveProviderAuth } from "../providers/application";
import { assertVisionCapableProvider, completeVision } from "../providers/vision";
import { AgentProviderError } from "../providers/vision-model";
import { cleanPageSource } from "./screen";
import type { DeviceSession } from "./session";

const groundResultSchema = z.object({
	x: z.number().min(0).max(1000),
	y: z.number().min(0).max(1000),
});

const GROUND_SYSTEM = `You locate UI elements on a mobile screen.
Respond with ONLY JSON: {"x":0-1000,"y":0-1000} for the center of the best match.
Coordinates use a 0–1000 normalized grid (0,0 top-left).`;

/**
 * Resolve a natural-language element description to 0–1000 coords using the
 * active local provider (vision preferred; falls back to cleaned tree text).
 */
export async function groundDescription(
	session: DeviceSession,
	description: string,
): Promise<{ x: number; y: number }> {
	const auth = await assertVisionCapableProvider(await resolveActiveProviderAuth()).catch(
		(error: unknown) => {
			if (error instanceof AgentProviderError) {
				throw new Error(error.message);
			}
			throw error;
		},
	);

	const shot = await session.captureFrame();
	const window = await session.getWindowSize();
	const raw = await session.pageSource();
	const cleaned = cleanPageSource(raw, window);
	const treeSummary = cleaned.elements
		.slice(0, 80)
		.map((el) => `${el.label || el.type} @(${el.x},${el.y}) ${el.width}x${el.height}`)
		.join("\n");

	const prompt = `Find: ${description}\n\nVisible elements:\n${treeSummary || "(none)"}`;

	try {
		const object = await completeVision(auth, {
			schema: groundResultSchema,
			system: GROUND_SYSTEM,
			prompt,
			imageBase64: shot.base64,
		});
		return { x: object.x, y: object.y };
	} catch (error) {
		if (error instanceof AgentProviderError) throw new Error(error.message);
		if (error instanceof Error) throw error;
		throw new Error(String(error));
	}
}
