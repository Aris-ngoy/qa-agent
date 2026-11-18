import { getCatalogDb } from "../catalog/db";
import { providers } from "../providers/schema";

/**
 * A faked Decide: an OpenAI-compatible endpoint behind a custom Provider. Each instruction
 * is one tap at the middle of the page, which verify then accepts, unless `failWith` is set.
 * While `held` is set, a Decide waits for it (only one whose prompt has `holdOn`, when that
 * is set), and `deciding` says one has arrived.
 */
export type FakeVision = {
	url: string;
	prompts: string[];
	failWith: string | null;
	held: Promise<void> | null;
	holdOn: string | null;
	deciding: boolean;
	stop: () => void;
};

export function startFakeVision(): FakeVision {
	const vision: FakeVision = {
		url: "",
		prompts: [],
		failWith: null,
		held: null,
		holdOn: null,
		deciding: false,
		stop: () => {},
	};
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = (await request.json()) as {
				messages: Array<{ role: string; content: unknown }>;
			};
			const system = String(body.messages.find((message) => message.role === "system")?.content);
			const user = body.messages.find((message) => message.role === "user")?.content;
			const prompt = Array.isArray(user)
				? user.map((part: { text?: string }) => part.text ?? "").join("\n")
				: String(user);
			const verifying = system.startsWith("You check whether ONE");
			if (!verifying) {
				vision.prompts.push(prompt);
				if (vision.holdOn === null || prompt.includes(vision.holdOn)) {
					vision.deciding = true;
					await vision.held;
				}
			}
			const reply = vision.failWith
				? { type: "fail", reason: vision.failWith, thoughts: "The page cannot do this." }
				: verifying
					? { type: "verify", reason: "Done", thoughts: "The tap landed." }
					: { type: "tap", x: 500, y: 500, reason: "tap the middle", thoughts: "Middle." };
			return Response.json({
				id: "chatcmpl-fake",
				object: "chat.completion",
				created: 0,
				model: "fake-vision",
				choices: [
					{
						index: 0,
						message: { role: "assistant", content: JSON.stringify(reply) },
						finish_reason: "stop",
					},
				],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			});
		},
	});
	vision.url = `http://127.0.0.1:${server.port}/v1`;
	vision.stop = () => server.stop(true);
	return vision;
}

/** Make `vision` the default Provider. Written straight to the catalog: a key would be encrypted with the real ~/.yoqa key. */
export async function addFakeVisionProvider(vision: FakeVision): Promise<void> {
	await getCatalogDb().insert(providers).values({
		id: "prov_fake_vision",
		kind: "custom",
		label: "Fake vision",
		baseUrl: vision.url,
		defaultModel: "fake-vision",
		isDefault: 1,
		createdAt: 0,
		updatedAt: 0,
	});
}
