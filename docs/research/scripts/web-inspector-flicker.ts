// Flicker harness for #344. Launches a Chromium (temp profile, the lane's flags),
// attaches like web-direct-lane's attachPage, then runs one variant at a time against a
// probe page and reports what the page observed and how fast captures came back.
//
// bun harness.ts <chrome|dia> <desktop|mobile> [variant ...]

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCdp } from "/Users/arisngoy/PROJECTS/qa-agent/services/runner/src/domains/devices/cdp-client.ts";

const BROWSERS = {
	chrome:
		"/Users/arisngoy/.cache/puppeteer/chrome/mac_arm-133.0.6943.141/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
	dia: "/Applications/Dia.app/Contents/MacOS/Dia",
} as const;
const PRESETS = {
	desktop: { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
	mobile: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
} as const;
const LAUNCH_FLAGS = [
	"--remote-debugging-port=0",
	"--no-first-run",
	"--no-default-browser-check",
	"--disable-search-engine-choice-screen",
	"--disable-sync",
	"--disable-default-apps",
	"--use-mock-keychain",
	"--password-store=basic",
];
const RUN_MS = Number(process.env.RUN_MS ?? 8000);

type Variant = {
	emulate: boolean | "dpr2";
	poll: "png" | "jpeg" | "png-clip" | "screencast" | "none";
	pollMs: number;
	tree: number | null; // tree poll interval, ms
	bringToFront: boolean; // on every poll tick
	reEmulate: boolean; // setDeviceMetricsOverride on every poll tick
	observe?: boolean; // screencast alongside, recording each painted frame's size
	fitWindow?: boolean; // size the browser window so its view is the preset's viewport
};
const base: Variant = {
	emulate: true,
	poll: "png",
	pollMs: 250,
	tree: 8000,
	bringToFront: false,
	reEmulate: false,
};
const VARIANTS: Record<string, Variant> = {
	idle: { ...base, poll: "none", tree: null },
	current: base, // what the Inspector does today
	"png-only": { ...base, tree: null },
	"no-emulation": { ...base, emulate: false },
	"dpr-matches-host": { ...base, emulate: "dpr2" },
	jpeg: { ...base, poll: "jpeg" },
	"png-clip": { ...base, poll: "png-clip" },
	screencast: { ...base, poll: "screencast" },
	"tree-only-250": { ...base, poll: "none", tree: 250 },
	"tree-only-8000": { ...base, poll: "none" },
	"bring-to-front": { ...base, poll: "none", tree: null, bringToFront: true },
	"re-emulate": { ...base, poll: "none", tree: null, reEmulate: true },
	"png-1000": { ...base, pollMs: 1000, tree: null },
	"png-tight": { ...base, pollMs: 0, tree: null },
	// A screencast watches what the compositor paints while the poll runs.
	"observe-idle": { ...base, poll: "none", tree: null, observe: true },
	"observe-png": { ...base, tree: null, observe: true },
	"observe-jpeg": { ...base, poll: "jpeg", tree: null, observe: true },
	"observe-png-clip": { ...base, poll: "png-clip", tree: null, observe: true },
	"observe-png-no-emulation": { ...base, emulate: false, tree: null, observe: true },
	"observe-png-dpr2": { ...base, emulate: "dpr2", tree: null, observe: true },
	"observe-tree-250": { ...base, poll: "none", tree: 250, observe: true },
	"observe-bring-to-front": {
		...base,
		poll: "none",
		tree: null,
		bringToFront: true,
		observe: true,
	},
	"observe-png-fit-window-dpr2": {
		...base,
		emulate: "dpr2",
		tree: null,
		observe: true,
		fitWindow: true,
	},
	"observe-png-fit-window": { ...base, tree: null, observe: true, fitWindow: true },
	"observe-re-emulate": { ...base, poll: "none", tree: null, reEmulate: true, observe: true },
};

/** Width × height from a JPEG's SOF marker. */
function jpegSize(base64: string): string {
	const b = Buffer.from(base64, "base64");
	for (let i = 2; i < b.length - 9; ) {
		if (b[i] !== 0xff) return "?";
		const marker = b[i + 1] ?? 0;
		const len = b.readUInt16BE(i + 2);
		if (marker >= 0xc0 && marker <= 0xc3)
			return `${b.readUInt16BE(i + 7)}x${b.readUInt16BE(i + 5)}`;
		i += 2 + len;
	}
	return "?";
}

const PROBE = `
<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{margin:0;font:16px system-ui}#box{width:120px;height:120px;background:#36c;animation:spin 2s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}</style>
<h1>Flicker probe</h1><div id=box></div><p>${"Lorem ipsum dolor sit amet. ".repeat(60)}</p>
<script>
const p = window.__probe = { frames: 0, gaps: [], resize: [], vv: [], dpr: [], focus: [], vis: [], start: performance.now() };
let last = performance.now(), lastDpr = devicePixelRatio;
function frame(t){ p.frames++; const d=t-last; if(d>50) p.gaps.push(Math.round(d)); last=t;
  if(devicePixelRatio!==lastDpr){ p.dpr.push([Math.round(t), lastDpr, devicePixelRatio]); lastDpr=devicePixelRatio; }
  requestAnimationFrame(frame);} requestAnimationFrame(frame);
addEventListener('resize',()=>p.resize.push([Math.round(performance.now()),innerWidth,innerHeight,devicePixelRatio]));
visualViewport.addEventListener('resize',()=>p.vv.push([Math.round(performance.now()),visualViewport.width,visualViewport.height,visualViewport.scale]));
addEventListener('focus',()=>p.focus.push(['focus',Math.round(performance.now())]));
addEventListener('blur',()=>p.focus.push(['blur',Math.round(performance.now())]));
document.addEventListener('visibilitychange',()=>p.vis.push([Math.round(performance.now()),document.visibilityState]));
</script>`;

const server = Bun.serve({
	port: 0,
	fetch: () => new Response(PROBE, { headers: { "content-type": "text/html" } }),
});
const probeUrl = `http://127.0.0.1:${server.port}/`;

const [browserName = "chrome", presetName = "mobile", ...names] = process.argv.slice(2);
const executable = BROWSERS[browserName as keyof typeof BROWSERS];
const preset = PRESETS[presetName as keyof typeof PRESETS];
const runNames = names.length ? names : Object.keys(VARIANTS);

const profileDir = await mkdtemp(join(tmpdir(), "yoqa-flicker-"));
const proc = Bun.spawn(
	[executable, `--user-data-dir=${profileDir}`, ...LAUNCH_FLAGS, "about:blank"],
	{
		stdout: "ignore",
		stderr: "ignore",
	},
);
let socketUrl: string | null = null;
for (let i = 0; i < 300 && !socketUrl; i++) {
	for (const file of ["DevToolsActivePort", "User Data/DevToolsActivePort"]) {
		const text = await readFile(join(profileDir, file), "utf8").catch(() => "");
		const [port, path] = text.split("\n").map((l) => l.trim());
		if (port && path?.startsWith("/")) socketUrl = `ws://127.0.0.1:${port}${path}`;
	}
	if (!socketUrl) await Bun.sleep(100);
}
if (!socketUrl) throw new Error("no DevToolsActivePort");
const client = await connectCdp(socketUrl);
// biome-ignore lint/suspicious/noExplicitAny: CDP methods beyond the lane's typed CdpCommands
type Json = any;
const send = (method: string, params: object = {}, sessionId?: string): Promise<Json> =>
	(client.send as (m: string, p: object, s?: string) => Promise<Json>)(method, params, sessionId);

const version = await send("Browser.getVersion");
console.log(`# ${version.product} · preset ${presetName} · ${RUN_MS} ms per variant`);

async function runVariant(name: string, v: Variant) {
	const { targetId } = await send("Target.createTarget", { url: "about:blank" });
	const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
	const call = (m: string, p: object = {}) => send(m, p, sessionId);
	await call("Page.enable");
	await call("Runtime.enable");
	const metrics =
		v.emulate === "dpr2" ? { ...preset, deviceScaleFactor: 2 } : v.emulate ? preset : null;
	const emulate = async () => {
		if (!metrics) return;
		const { width, height, deviceScaleFactor, mobile } = metrics;
		await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor, mobile });
		if (mobile)
			await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
	};
	if (v.fitWindow && metrics) {
		await call("Page.navigate", { url: "about:blank" });
		await Bun.sleep(300);
		const { windowId, bounds } = await send("Browser.getWindowForTarget", { targetId });
		const m = await call("Page.getLayoutMetrics");
		const dw = bounds.width - m.cssVisualViewport.clientWidth;
		const dh = bounds.height - m.cssVisualViewport.clientHeight;
		await send("Browser.setWindowBounds", {
			windowId,
			bounds: { width: metrics.width + dw, height: metrics.height + dh },
		});
		await Bun.sleep(500);
		const after = await call("Page.getLayoutMetrics");
		console.error(
			`fit window: view ${after.cssVisualViewport.clientWidth}x${after.cssVisualViewport.clientHeight}`,
		);
	}
	await emulate();
	await call("Page.bringToFront");
	await call("Page.navigate", { url: probeUrl });
	await Bun.sleep(1200); // load and settle; the probe's own clock starts at load

	await call("Runtime.evaluate", {
		expression:
			"Object.assign(__probe,{frames:0,gaps:[],resize:[],vv:[],dpr:[],focus:[],vis:[],start:performance.now()})",
	});

	const captureMs: number[] = [];
	const treeMs: number[] = [];
	let screencastFrames = 0;
	let stop = false;
	const loops: Promise<void>[] = [];

	const observed = new Map<string, number>();
	if (v.observe) {
		client.on("Page.screencastFrame", (params: Json, sid) => {
			if (sid !== sessionId) return;
			const m = params.metadata;
			const key = `${jpegSize(params.data)} dev=${Math.round(m.deviceWidth)}x${Math.round(m.deviceHeight)} pageScale=${+m.pageScaleFactor.toFixed(2)}`;
			observed.set(key, (observed.get(key) ?? 0) + 1);
			if (process.env.SAVE_FRAME && observed.get(key) === 3)
				Bun.write(`frame-${name}-${key.split(" ")[0]}.jpg`, Buffer.from(params.data, "base64"));
			void call("Page.screencastFrameAck", { sessionId: params.sessionId });
		});
		await call("Page.startScreencast", { format: "jpeg", quality: 30, everyNthFrame: 1 });
	}
	if (v.poll === "screencast") {
		client.on("Page.screencastFrame", (params: Json, sid) => {
			if (sid !== sessionId) return;
			screencastFrames++;
			void call("Page.screencastFrameAck", { sessionId: params.sessionId });
		});
		await call("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });
	} else if (v.poll !== "none" || v.bringToFront || v.reEmulate) {
		loops.push(
			(async () => {
				while (!stop) {
					const t = performance.now();
					if (v.bringToFront) await call("Page.bringToFront");
					if (v.reEmulate) await emulate();
					if (v.poll === "png") await call("Page.captureScreenshot", { format: "png" });
					if (v.poll === "jpeg")
						await call("Page.captureScreenshot", { format: "jpeg", quality: 80 });
					if (v.poll === "png-clip" && metrics)
						await call("Page.captureScreenshot", {
							format: "png",
							clip: { x: 0, y: 0, width: metrics.width, height: metrics.height, scale: 1 },
						});
					captureMs.push(performance.now() - t);
					const wait = v.pollMs - (performance.now() - t);
					if (wait > 0) await Bun.sleep(wait);
				}
			})(),
		);
	}
	if (v.tree !== null) {
		loops.push(
			(async () => {
				while (!stop) {
					const t = performance.now();
					await Promise.all([
						call("Accessibility.getFullAXTree"),
						call("DOMSnapshot.captureSnapshot", { computedStyles: [] }),
					]);
					treeMs.push(performance.now() - t);
					await Bun.sleep(Math.max(0, (v.tree ?? 0) - (performance.now() - t)));
				}
			})(),
		);
	}
	await Bun.sleep(RUN_MS);
	stop = true;
	await Promise.all(loops);
	if (v.poll === "screencast" || v.observe) await call("Page.stopScreencast");

	if (v.observe)
		console.error(
			`${name}: innerWidth after run =`,
			(await call("Runtime.evaluate", { expression: "innerWidth", returnByValue: true })).result
				.value,
		);
	const { result } = await call("Runtime.evaluate", {
		expression: "JSON.stringify({...__probe, elapsed: performance.now()-__probe.start})",
		returnByValue: true,
	});
	const p = JSON.parse(result.value);
	const median = (xs: number[]) =>
		xs.length ? Math.round([...xs].sort((a, b) => a - b)[xs.length >> 1]) : null;
	const pollFps = captureMs.length ? +(captureMs.length / (RUN_MS / 1000)).toFixed(1) : null;
	console.log(
		JSON.stringify({
			variant: name,
			pageFps: +(p.frames / (p.elapsed / 1000)).toFixed(1),
			longGaps: p.gaps.length,
			maxGapMs: p.gaps.length ? Math.max(...p.gaps) : 0,
			resize: p.resize.length,
			vvResize: p.vv.length,
			dprChanges: p.dpr.length,
			focusBlur: p.focus.length,
			visibility: p.vis.length,
			polls: captureMs.length,
			pollFps,
			captureMedianMs: median(captureMs),
			screencastFps:
				v.poll === "screencast" ? +(screencastFrames / (RUN_MS / 1000)).toFixed(1) : undefined,
			treeMedianMs: median(treeMs),
			observedFrames: v.observe ? Object.fromEntries(observed) : undefined,
			sample: {
				resize: p.resize.slice(0, 3),
				vv: p.vv.slice(0, 3),
				dpr: p.dpr.slice(0, 3),
				gaps: p.gaps.slice(0, 8),
			},
		}),
	);
	await send("Target.closeTarget", { targetId });
}

try {
	for (const name of runNames) {
		const v = VARIANTS[name];
		if (!v) throw new Error(`unknown variant ${name}`);
		await runVariant(name, v);
	}
} finally {
	await client.close();
	proc.kill("SIGTERM");
	await Promise.race([proc.exited, Bun.sleep(2000)]);
	proc.kill("SIGKILL");
	await rm(profileDir, { recursive: true, force: true });
	server.stop(true);
}
