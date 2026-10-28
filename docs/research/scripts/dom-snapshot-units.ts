// One CDP client, no lane: does DOMSnapshot's layout box match getBoundingClientRect?
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdp } from "/Users/arisngoy/PROJECTS/qa-agent/services/runner/src/domains/devices/cdp-client.ts";
// biome-ignore lint/suspicious/noExplicitAny: CDP payloads the lane does not type
type Json = any;
const exe = process.argv[2] ?? "";
const headless = process.argv[3] === "headless";
const dir = await mkdtemp(join(tmpdir(), "snap-"));
const proc = Bun.spawn(
	[
		exe,
		`--user-data-dir=${dir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		...(headless ? ["--headless=new"] : []),
		"about:blank",
	],
	{ stdout: "ignore", stderr: "ignore" },
);
let ws = "";
for (let i = 0; i < 200 && !ws; i++) {
	const [p, path] = (
		await readFile(
			join(dir, exe.includes("Dia") ? "User Data/DevToolsActivePort" : "DevToolsActivePort"),
			"utf8",
		).catch(() => "")
	).split("\n");
	if (path?.startsWith("/")) ws = `ws://127.0.0.1:${p}${path.trim()}`;
	else await Bun.sleep(100);
}
const c = await connectCdp(ws);
const send = (m: string, p: object = {}, s?: string): Promise<Json> => (c.send as Json)(m, p, s);
const { targetInfos } = await send("Target.getTargets");
const page = targetInfos.find((t: Json) => t.type === "page") ?? {
	targetId: (await send("Target.createTarget", { url: "about:blank" })).targetId,
};
const { sessionId } = await send("Target.attachToTarget", {
	targetId: page.targetId,
	flatten: true,
});
const call = (m: string, p: object = {}) => send(m, p, sessionId);
await call("Page.enable");
for (const emu of [
	null,
	{ width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
	{ width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
]) {
	if (emu) await call("Emulation.setDeviceMetricsOverride", emu);
	else await call("Emulation.clearDeviceMetricsOverride");
	await call("Page.navigate", {
		url: "data:text/html,<body style='margin:10px;height:3000px'><div id=b style='margin:40px 0 0 30px;width:100px;height:50px;background:red'></div>",
	});
	await Bun.sleep(700);
	await call("Runtime.evaluate", { expression: "scrollTo(0, 100)" });
	await Bun.sleep(200);
	const css = (
		await call("Runtime.evaluate", {
			expression:
				"JSON.stringify([devicePixelRatio, Object.values(b.getBoundingClientRect().toJSON()).slice(0,4)])",
			returnByValue: true,
		})
	).result.value;
	const snap = await call("DOMSnapshot.captureSnapshot", {
		computedStyles: [],
		includeDOMRects: true,
	});
	const d = snap.documents[0];
	const attrs = d.nodes.attributes;
	let idx = -1;
	attrs.forEach((a: number[], i: number) => {
		for (let k = 0; k < a.length; k += 2)
			if (snap.strings[a[k]] === "id" && snap.strings[a[k + 1]] === "b") idx = i;
	});
	const li = d.layout.nodeIndex.indexOf(idx);
	console.log(
		JSON.stringify({
			headless,
			emulation: emu ? `${emu.width}@${emu.deviceScaleFactor}` : "none",
			cssDprAndRect: JSON.parse(css),
			snapshotBounds: d.layout.bounds[li],
			clientRects: d.layout.clientRects?.[li],
			offsetRects: d.layout.offsetRects?.[li],
			contentWidth: d.contentWidth,
			scrollOffsetY: d.scrollOffsetY,
			layoutMetrics: await call("Page.getLayoutMetrics").then((m: Json) => ({
				css: m.cssLayoutViewport.clientWidth,
				dev: m.layoutViewport.clientWidth,
			})),
		}),
	);
}
await c.close();
proc.kill("SIGKILL");
await rm(dir, { recursive: true, force: true });
