import { describe, expect, test } from "bun:test";
import { RunnerClient, RunnerRequestError, RunnerUnreachableError } from "./index";

/** A client whose fetch does what `respond` says. Bun's fetch also has preconnect; the client only calls it. */
function clientWith(respond: () => Promise<Response>): RunnerClient {
	return new RunnerClient({
		baseUrl: "http://127.0.0.1:7420",
		fetchImpl: respond as unknown as typeof fetch,
	});
}

describe("a request that gets no answer", () => {
	test("throws RunnerUnreachableError with the fetch error as its cause", async () => {
		const refused = new TypeError("Unable to connect. Is the computer able to access the url?");
		const error = await clientWith(() => Promise.reject(refused))
			.health()
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RunnerUnreachableError);
		expect((error as RunnerUnreachableError).message).toBe(refused.message);
		expect((error as RunnerUnreachableError).url).toBe("http://127.0.0.1:7420/health");
		expect((error as RunnerUnreachableError).cause).toBe(refused);
	});

	test("an abort stays an abort", async () => {
		const aborted = new DOMException("The operation was aborted.", "AbortError");
		const error = await clientWith(() => Promise.reject(aborted))
			.health()
			.catch((caught: unknown) => caught);
		expect(error).toBe(aborted);
	});

	test("an answer with an error status is a RunnerRequestError, not unreachable", async () => {
		const error = await clientWith(() =>
			Promise.resolve(Response.json({ error: "boom" }, { status: 500 })),
		)
			.listApps()
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RunnerRequestError);
		expect(error).not.toBeInstanceOf(RunnerUnreachableError);
	});
});
