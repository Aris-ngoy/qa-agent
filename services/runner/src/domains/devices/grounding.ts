import { APICallError, generateObject } from "ai";
import { z } from "zod";
import { resolveActiveProviderAuth } from "../providers/application";
import { groundWithCursorCli } from "../providers/cursor-decide";
import {
	AgentProviderError,
	assertVisionCapableProvider,
	createVisionModel,
	formatProviderHttpError,
} from "../providers/vision-model";
import { prepareVisionImage } from "../runs/agent";
import type { DeviceSession } from "../runs/session";
import { cleanPageSource } from "./screen";

const groundResultSchema = z.object({
	x: z.number().min(0).max(1000),
	y: z.number().min(0).max(1000),
});

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

	const system = `You locate UI elements on a mobile screen.
Respond with ONLY JSON: {"x":0-1000,"y":0-1000} for the center of the best match.
Coordinates use a 0–1000 normalized grid (0,0 top-left).`;

	const userText = `Find: ${description}\n\nVisible elements:\n${treeSummary || "(none)"}`;
	const vision = await prepareVisionImage(shot.base64);

	if (auth.kind === "cursor") {
		try {
			return await groundWithCursorCli({
				auth,
				prompt: `${system}\n\n${userText}`,
				imageBase64: vision.base64,
				mediaType: vision.mediaType,
			});
		} catch (error) {
			if (error instanceof AgentProviderError) throw new Error(error.message);
			if (error instanceof Error) throw error;
			throw new Error(String(error));
		}
	}

	const { model, label } = await createVisionModel(auth);

	try {
		const { object } = await generateObject({
			model,
			schema: groundResultSchema,
			system,
			maxOutputTokens: 256,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "image",
							image: vision.base64,
							mediaType: vision.mediaType,
						},
						{ type: "text", text: userText },
					],
				},
			],
		});
		return { x: object.x, y: object.y };
	} catch (error) {
		if (APICallError.isInstance(error)) {
			const body = error.responseBody ?? error.message;
			throw new Error(formatProviderHttpError(label, error.statusCode ?? 0, body));
		}
		if (error instanceof Error) throw error;
		throw new Error(String(error));
	}
}
