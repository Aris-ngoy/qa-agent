import { expect, test } from "bun:test";
import { CdpSessionGoneError, connectCdp } from "./cdp-client";
import { startFakeCdp } from "./fake-cdp";

test("a command to a page that closes before it answers fails at once, not at the timeout", async () => {
	const browser = startFakeCdp({
		viewport: { width: 1280, height: 800 },
		restoresSession: ["https://example.com/"],
	});
	const client = await connectCdp(`ws://127.0.0.1:${browser.port}/devtools/browser/fake`, {
		commandTimeoutMs: 2_000,
	});
	const [page] = (await client.send("Target.getTargets", {})).targetInfos;
	const { sessionId } = await client.send("Target.attachToTarget", {
		targetId: page?.targetId ?? "",
		flatten: true,
	});
	const started = Date.now();
	const error = await client.send("Page.enable", {}, sessionId).catch((caught: unknown) => caught);
	expect(error).toBeInstanceOf(CdpSessionGoneError);
	expect((error as Error).message).toBe("Page.enable: the page closed before it answered");
	expect(Date.now() - started).toBeLessThan(1_000);
	// The socket is still open for the pages that stayed.
	expect((await client.send("Target.getTargets", {})).targetInfos.map(({ url }) => url)).toEqual([
		"https://example.com/",
	]);
	await client.close();
	browser.kill();
});
