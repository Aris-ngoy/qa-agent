// Does a tap by label land on its element on a Retina Mac? Expo demo, mobile preset.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performAction } from "/Users/arisngoy/PROJECTS/qa-agent/services/runner/src/domains/devices/interaction.ts";
import { createWebDirectSession } from "/Users/arisngoy/PROJECTS/qa-agent/services/runner/src/domains/devices/web-direct-lane.ts";
// biome-ignore lint/suspicious/noExplicitAny: CDP payloads the lane does not type
type Json = any;
const S =
	"/private/tmp/claude-501/-Users-arisngoy-PROJECTS-qa-agent/542ba288-cedc-4ed4-849d-d2e8d38047a6/scratchpad";
const srv = Bun.serve({
	port: 0,
	async fetch(r) {
		const p = new URL(r.url).pathname;
		const f = Bun.file(join(S, "expo-dist", p === "/" ? "index.html" : p));
		return (await f.exists())
			? new Response(f)
			: new Response(Bun.file(join(S, "expo-dist/index.html")));
	},
});
const CFT =
	"/Users/arisngoy/.cache/puppeteer/chrome/mac_arm-133.0.6943.141/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const dir = await mkdtemp(join(tmpdir(), "tap-"));
const proc = Bun.spawn(
	[
		CFT,
		`--user-data-dir=${dir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		...(process.argv[2] === "headless" ? ["--headless=new"] : []),
		"about:blank",
	],
	{ stdout: "ignore", stderr: "ignore" },
);
let port = "";
for (let i = 0; i < 200 && !port; i++) {
	port =
		(await readFile(join(dir, "DevToolsActivePort"), "utf8").catch(() => ""))
			.split("\n")[0]
			?.trim() ?? "";
	if (!port) await Bun.sleep(100);
}
for (const viewport of ["mobile", "desktop"] as const) {
	const session = await createWebDirectSession({
		platform: "web",
		deviceId: `chromium-cdp-${port}`,
		viewport,
	});
	await session.openUrl(`http://127.0.0.1:${srv.port}/`);
	await Bun.sleep(1500);
	const count = async () => (await session.pageSource()).match(/"Count: (-?\d+)"/)?.[1];
	const before = await count();
	const res = await performAction(session, { kind: "tap", label: "Increment" } as Json);
	await Bun.sleep(400);
	console.log(
		JSON.stringify({
			mode: process.argv[2] ?? "headful",
			viewport,
			before,
			after: await count(),
			tappedAt: (res as Json).x !== undefined ? [(res as Json).x, (res as Json).y] : res,
		}).slice(0, 300),
	);
	await session.quit();
}
proc.kill("SIGKILL");
await rm(dir, { recursive: true, force: true });
srv.stop(true);
process.exit(0);
