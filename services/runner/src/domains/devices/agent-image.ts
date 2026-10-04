import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pngSizeFromBase64 } from "./android-gestures";

/** Default long edge for an Agent image (connector + Decide). */
export const DEFAULT_AGENT_IMAGE_EDGE = 1000;

export type AgentImage = {
	base64: string;
	mediaType: "image/png" | "image/jpeg";
	downscaled: boolean;
};

function targetEdge(
	pngBase64: string,
	options: { full?: boolean; scale?: number; maxEdge?: number },
): number | null {
	if (options.full || options.scale === 1) return null;
	if (options.scale != null) {
		const size = pngSizeFromBase64(pngBase64);
		if (!size) return options.maxEdge ?? DEFAULT_AGENT_IMAGE_EDGE;
		return Math.max(1, Math.round(Math.max(size.width, size.height) * options.scale));
	}
	return options.maxEdge ?? DEFAULT_AGENT_IMAGE_EDGE;
}

/**
 * Reduced-size copy of a screenshot prepared for a model. The raw frame is never
 * replaced; callers keep it and hand this copy to the connector / Decide.
 */
export async function prepareAgentImage(
	pngBase64: string,
	options: { full?: boolean; scale?: number; maxEdge?: number } = {},
): Promise<AgentImage> {
	const bytes = Buffer.from(pngBase64, "base64");
	const edge = targetEdge(pngBase64, options);
	if (bytes.byteLength === 0 || edge == null || process.platform !== "darwin") {
		return { base64: pngBase64, mediaType: "image/png", downscaled: false };
	}

	const dir = await mkdtemp(join(tmpdir(), "yoqa-agent-image-"));
	const inPath = join(dir, "shot.png");
	const outPath = join(dir, "shot.jpg");
	try {
		await writeFile(inPath, new Uint8Array(bytes));
		const proc = Bun.spawn(
			[
				"sips",
				"-Z",
				String(edge),
				"-s",
				"format",
				"jpeg",
				"-s",
				"formatOptions",
				"70",
				inPath,
				"--out",
				outPath,
			],
			{ stdout: "ignore", stderr: "pipe" },
		);
		if ((await proc.exited) !== 0) {
			return { base64: pngBase64, mediaType: "image/png", downscaled: false };
		}
		const jpeg = await readFile(outPath);
		if (jpeg.byteLength === 0 || jpeg.byteLength >= bytes.byteLength) {
			return { base64: pngBase64, mediaType: "image/png", downscaled: false };
		}
		return { base64: jpeg.toString("base64"), mediaType: "image/jpeg", downscaled: true };
	} catch {
		return { base64: pngBase64, mediaType: "image/png", downscaled: false };
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}
