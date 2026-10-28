// Pick audit for #345. For each page: list what a tester can see and would point at
// (DOM side, every frame and open shadow root), read the Screen through the real web
// Direct lane, hit-test each target's centre with the Inspector's own hitTestElements,
// and sort every miss by cause. Then the two timing cases: a scroll and a screen change
// against the tree the Inspector had cached before them.
//
// bun audit.ts <desktop|mobile> [page ...]

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hitTestElements } from "/Users/arisngoy/PROJECTS/qa-agent/apps/desktop/src/mainview/features/inspector/utils/selection.ts";
import { connectCdp } from "/Users/arisngoy/PROJECTS/qa-agent/services/runner/src/domains/devices/cdp-client.ts";
import {
	type WebAxSource,
	cleanWebAxSource,
} from "/Users/arisngoy/PROJECTS/qa-agent/services/runner/src/domains/devices/screen.ts";
import { createWebDirectSession } from "/Users/arisngoy/PROJECTS/qa-agent/services/runner/src/domains/devices/web-direct-lane.ts";
// biome-ignore lint/suspicious/noExplicitAny: CDP payloads the lane does not type
type Json = any;

const S =
	"/private/tmp/claude-501/-Users-arisngoy-PROJECTS-qa-agent/542ba288-cedc-4ed4-849d-d2e8d38047a6/scratchpad";
const CHROME =
	"/Users/arisngoy/.cache/puppeteer/chrome/mac_arm-133.0.6943.141/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PRESETS = {
	desktop: { width: 1280, height: 800 },
	mobile: { width: 390, height: 844 },
} as const;

// ---- local fixtures: the Expo export, and a page with iframes and shadow DOM ----
const expo = Bun.serve({
	port: 0,
	async fetch(req) {
		const path = new URL(req.url).pathname;
		const file = Bun.file(join(S, "expo-dist", path === "/" ? "index.html" : path));
		return (await file.exists())
			? new Response(file)
			: new Response(Bun.file(join(S, "expo-dist/index.html")));
	},
});
const CHILD = `<!doctype html><body style="font:15px system-ui;margin:8px">
<h3>Inside the frame</h3><button id=frame-btn>Frame button</button> <a href="#x">Frame link</a>
<p>Frame paragraph text.</p><input placeholder="Frame input"></body>`;
// The cross-origin child lives on a different host name, so Chrome puts it in its own process.
const child = Bun.serve({
	port: 0,
	fetch: () => new Response(CHILD, { headers: { "content-type": "text/html" } }),
});
const FIXTURE = `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<body style="font:16px system-ui;margin:12px">
<h1>Frames and shadow DOM</h1>
<p>A paragraph in the page itself.</p>
<button>Page button</button>
<div onclick="void 0" style="cursor:pointer;padding:8px;background:#eee;width:160px">Clickable div</div>
<div style="cursor:pointer;width:32px;height:32px;background:#c33" onclick="void 0"></div>
<img alt="" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%2369c'/%3E%3C/svg%3E" width=40 height=40>
<fancy-card></fancy-card>
<iframe src="/child" style="width:300px;height:190px;border:1px solid #999"></iframe>
<iframe src="http://localhost:${child.port}/" style="width:300px;height:190px;border:1px solid #999"></iframe>
<script>
customElements.define('fancy-card', class extends HTMLElement { connectedCallback(){
  const r = this.attachShadow({mode:'open'});
  r.innerHTML = '<style>div{border:1px solid #888;padding:8px;width:220px}</style><div><h2>Shadow card</h2><p>Shadow text</p><button>Shadow button</button></div>';
}});
</script>`;
const fixture = Bun.serve({
	port: 0,
	fetch: (req) =>
		new Response(new URL(req.url).pathname === "/child" ? CHILD : FIXTURE, {
			headers: { "content-type": "text/html" },
		}),
});

type Page = { name: string; url: string; change?: string; scroll?: boolean };
const PAGES: Page[] = [
	{
		name: "todomvc-react",
		url: "https://todomvc.com/examples/react/dist/",
		// a React SPA: seed three todos, then the change is the "Completed" filter
		change: "document.querySelector('a[href=\"#/completed\"]').click()",
	},
	{
		name: "react-dev",
		url: "https://react.dev/learn",
		scroll: true,
	},
	{
		name: "expo-demo",
		url: `http://127.0.0.1:${expo.port}/`,
		change: "document.querySelector('[aria-label=\"Open greeting\"]').click()",
	},
	{ name: "frames-shadow", url: `http://127.0.0.1:${fixture.port}/` },
	{
		name: "mdn-iframe",
		url: "https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe",
		scroll: true,
	},
	{
		name: "bootstrap-forms",
		url: "https://getbootstrap.com/docs/5.3/forms/overview/",
		scroll: true,
	},
];

// ---- what a tester expects to pick, from inside each frame ----
// Controls; text not inside a control; images not inside a control. Visible, in view,
// and on top at their centre. Each is tagged data-yoqa-audit so the snapshot finds it.
const ENUMERATE = `(() => {
const CONTROL = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[contenteditable=""],[contenteditable=true],[role=button],[role=link],[role=checkbox],[role=radio],[role=switch],[role=tab],[role=menuitem],[role=option],[role=textbox],[role=combobox],[role=slider],[onclick],[tabindex]:not([tabindex="-1"])';
const out = []; let n = 0;
const vw = innerWidth, vh = innerHeight;
const visible = (el) => { const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05; };
const pointerTop = (el) => getComputedStyle(el).cursor === 'pointer' && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer');
const isControl = (el) => el.matches(CONTROL) || pointerTop(el);
const controlAncestor = (el) => { for (let p = el.parentElement || el.getRootNode().host; p; p = p.parentElement || (p.getRootNode && p.getRootNode().host)) if (p.matches && isControl(p)) return p; return null; };
function onTop(root, el, x, y) { const hit = root.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit) || hit.contains(el) && hit !== document.body && hit !== document.documentElement); }
function push(root, el, kind, r, text, inShadow) {
  if (r.width < 4 || r.height < 4) return;
  if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return;
  const cx = Math.min(Math.max(r.left + r.width/2, 0), vw-1), cy = Math.min(Math.max(r.top + r.height/2, 0), vh-1);
  if (!onTop(root, el, cx, cy)) return;
  const id = String(n++); el.setAttribute('data-yoqa-audit', id);
  out.push({ id, kind, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', text: (text || '').replace(/\\s+/g,' ').trim().slice(0,60), rect: { x: r.left, y: r.top, width: r.width, height: r.height }, cx, cy, inShadow });
}
function walk(root, inShadow) {
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) walk(el.shadowRoot, true);
    if (!visible(el) || el.closest('[data-yoqa-skip]')) continue;
    const tag = el.tagName;
    if (tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HTML' || tag === 'BODY') continue;
    if (isControl(el)) { push(root, el, 'control', el.getBoundingClientRect(), el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || el.title, inShadow); continue; }
    if (controlAncestor(el)) continue;
    if (tag === 'IMG' || tag === 'CANVAS' || tag === 'VIDEO' || (tag === 'svg' && !el.parentElement?.closest('svg')) || el.getAttribute('role') === 'img') {
      push(root, el, 'image', el.getBoundingClientRect(), el.getAttribute('alt') || el.getAttribute('aria-label'), inShadow); continue;
    }
    const own = [...el.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
    if (!own.length) continue;
    const range = document.createRange(); range.setStartBefore(own[0]); range.setEndAfter(own[own.length-1]);
    push(root, el, 'text', range.getBoundingClientRect(), own.map((c) => c.textContent).join(' '), inShadow);
  }
}
walk(document, false);
return JSON.stringify(out);
})()`;

type Target = {
	id: string;
	kind: "control" | "text" | "image";
	tag: string;
	role: string;
	text: string;
	rect: { x: number; y: number; width: number; height: number };
	cx: number;
	cy: number;
	inShadow: boolean;
	frame: "main" | "same-origin iframe" | "cross-origin iframe";
};

const CORRECT = process.env.CORRECT === "1";
const presetName = (process.argv[2] ?? "mobile") as keyof typeof PRESETS;
const preset = PRESETS[presetName];
const pageNames = process.argv.slice(3);

const profileDir = await mkdtemp(join(tmpdir(), "yoqa-picks-"));
const proc = Bun.spawn(
	[
		CHROME,
		`--user-data-dir=${profileDir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-search-engine-choice-screen",
		"--disable-sync",
		"--use-mock-keychain",
		"--password-store=basic",
		"about:blank",
	],
	{ stdout: "ignore", stderr: "ignore" },
);
let port = "";
for (let i = 0; i < 300 && !port; i++) {
	port =
		(await readFile(join(profileDir, "DevToolsActivePort"), "utf8").catch(() => ""))
			.split("\n")[0]
			?.trim() ?? "";
	if (!port) await Bun.sleep(100);
}

const session = await createWebDirectSession({
	platform: "web",
	deviceId: `chromium-cdp-${port}`,
	viewport: presetName,
});
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const client = await connectCdp(version.webSocketDebuggerUrl);
const send = (m: string, p: object = {}, sid?: string): Promise<Json> =>
	(client.send as Json)(m, p, sid);
const { targetInfos } = await send("Target.getTargets");
const pageTarget = targetInfos.find(
	(t: Json) => t.type === "page" && !t.url.startsWith("devtools://"),
);
const { sessionId: sid } = await send("Target.attachToTarget", {
	targetId: pageTarget.targetId,
	flatten: true,
});
const call = (m: string, p: object = {}) => send(m, p, sid);
await call("Page.enable");
await call("DOM.enable");
// Cross-origin frames come as their own sessions.
const frameSessions = new Map<string, string>(); // frameId (= targetId) -> sessionId
client.on("Target.attachedToTarget", (params: Json) => {
	if (params.targetInfo.type === "iframe")
		frameSessions.set(params.targetInfo.targetId, params.sessionId);
});
await call("Target.setAutoAttach", {
	autoAttach: true,
	waitForDebuggerOnStart: false,
	flatten: true,
});

const evaluate = async (expression: string, sessionId = sid, contextId?: number) => {
	const r = await send(
		"Runtime.evaluate",
		{ expression, returnByValue: true, ...(contextId ? { contextId } : {}) },
		sessionId,
	);
	if (r.exceptionDetails)
		throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
	return r.result.value;
};

/** Every expected target, in the main viewport's CSS pixels. */
async function enumerate(): Promise<Target[]> {
	await evaluate(
		"document.querySelectorAll('[data-yoqa-audit]').forEach(e=>e.removeAttribute('data-yoqa-audit'))",
	);
	const targets: Target[] = JSON.parse(await evaluate(ENUMERATE)).map((t: Target) => ({
		...t,
		frame: "main",
	}));
	const { frameTree } = await call("Page.getFrameTree");
	const children: Json[] = [];
	const collect = (node: Json) => {
		for (const c of node.childFrames ?? []) {
			children.push(c);
			collect(c);
		}
	};
	collect(frameTree);
	// Out-of-process frames are their own targets, missing from the main frame tree.
	const known = new Set(children.map((c) => c.frame.id));
	for (const id of frameSessions.keys())
		if (!known.has(id))
			children.push({ frame: { id, url: "(out of process)", securityOrigin: "oopif" } });
	for (const { frame } of children) {
		let model: Json;
		try {
			const owner = await call("DOM.getFrameOwner", { frameId: frame.id });
			({ model } = await call("DOM.getBoxModel", { backendNodeId: owner.backendNodeId }));
		} catch {
			continue; // a frame with no box (hidden or detached)
		}
		const [ox, oy] = model.content;
		const crossSession = frameSessions.get(frame.id);
		if (process.env.DEBUG)
			console.log("frame", frame.url, frame.id, crossSession ?? "same process", [
				...frameSessions.keys(),
			]);
		let raw: string;
		let kind: Target["frame"];
		if (crossSession) {
			await send("Runtime.enable", {}, crossSession).catch(() => {});
			raw = await evaluate(ENUMERATE, crossSession).catch(() => "[]");
			kind = "cross-origin iframe";
		} else {
			const { executionContextId } = await call("Page.createIsolatedWorld", {
				frameId: frame.id,
				worldName: "audit",
			});
			raw = await evaluate(ENUMERATE, sid, executionContextId).catch(() => "[]");
			kind =
				frame.securityOrigin === frameTree.frame.securityOrigin
					? "same-origin iframe"
					: "cross-origin iframe";
		}
		for (const t of JSON.parse(raw) as Target[]) {
			const rect = { ...t.rect, x: t.rect.x + ox, y: t.rect.y + oy };
			const cx = t.cx + ox;
			const cy = t.cy + oy;
			if (cx < 0 || cy < 0 || cx >= preset.width || cy >= preset.height) continue;
			targets.push({ ...t, id: `${frame.id}:${t.id}`, rect, cx, cy, frame: kind });
		}
	}
	return targets;
}

/** backendNodeIds of each tagged element and its own text nodes, from the main frame's snapshot. */
async function auditIds(): Promise<Map<string, number[]>> {
	const snap = await call("DOMSnapshot.captureSnapshot", { computedStyles: [] });
	const ids = new Map<string, number[]>();
	const doc = snap.documents[0];
	const n = doc.nodes;
	const attrIdx = snap.strings.indexOf("data-yoqa-audit");
	if (attrIdx < 0) return ids;
	const byIndex = new Map<number, string>();
	n.attributes.forEach((attrs: number[], i: number) => {
		for (let a = 0; a < attrs.length; a += 2) {
			if (attrs[a] === attrIdx) {
				const id = snap.strings[attrs[a + 1]];
				byIndex.set(i, id);
				ids.set(id, [n.backendNodeId[i]]);
			}
		}
	});
	n.parentIndex.forEach((parent: number, i: number) => {
		const id = byIndex.get(parent);
		if (id !== undefined && n.nodeType[i] === 3) ids.get(id)?.push(n.backendNodeId[i]);
	});
	return ids;
}

type Rect = { x: number; y: number; width: number; height: number };
const iou = (a: Rect, b: Rect) => {
	const x1 = Math.max(a.x, b.x);
	const y1 = Math.max(a.y, b.y);
	const x2 = Math.min(a.x + a.width, b.x + b.width);
	const y2 = Math.min(a.y + a.height, b.y + b.height);
	const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
	return inter / (a.width * a.height + b.width * b.height - inter || 1);
};
const toCss = (e: { x: number; y: number; width: number; height: number }): Rect => ({
	x: (e.x / 1000) * preset.width,
	y: (e.y / 1000) * preset.height,
	width: (e.width / 1000) * preset.width,
	height: (e.height / 1000) * preset.height,
});
type Elements = ReturnType<typeof cleanWebAxSource>["elements"];

function picks(target: Target, elements: Elements) {
	const picked = hitTestElements(
		elements,
		(target.cx / preset.width) * 1000,
		(target.cy / preset.height) * 1000,
	);
	if (!picked) return { ok: false as const, picked: null, viaText: false };
	const r = toCss(picked);
	if (iou(r, target.rect) >= 0.5) return { ok: true, picked };
	// A control with no role: only its text is on the Screen, which still taps it by label.
	const label = target.text.slice(0, 20).toLowerCase();
	if (
		target.kind === "control" &&
		label &&
		picked.label.toLowerCase().includes(label) &&
		r.x >= target.rect.x - 2 &&
		r.x + r.width <= target.rect.x + target.rect.width + 2
	)
		return { ok: true, picked, viaText: true };
	// Text inside a named block (a heading, a list item) whose name is that text.
	const snippet = target.text.slice(0, 20).toLowerCase();
	if (
		target.kind === "text" &&
		snippet &&
		picked.label.toLowerCase().includes(snippet) &&
		r.width * r.height <= 4 * target.rect.width * target.rect.height
	)
		return { ok: true, picked };
	return { ok: false, picked };
}

const AX_ONLY_LABEL = (n: Json) => (typeof n?.name?.value === "string" ? n.name.value.trim() : "");

function cause(
	target: Target,
	ax: WebAxSource,
	elements: Elements,
	ids: Map<string, number[]>,
	picked: Elements[number] | null,
): string {
	if (target.frame !== "main") return `in a ${target.frame}`;
	const backend = new Set(ids.get(target.id) ?? []);
	const nodes = ax.axTree.filter(
		(n) => n.backendDOMNodeId !== undefined && backend.has(n.backendDOMNodeId),
	);
	const shadow = target.inShadow ? " (shadow DOM)" : "";
	if (backend.size === 0) return `not in the main-frame snapshot${shadow}`;
	if (nodes.length === 0) return `not in the accessibility tree${shadow}`;
	if (nodes.every((n) => n.ignored)) return `ignored in the accessibility tree${shadow}`;
	const live = nodes.filter((n) => !n.ignored);
	if (live.every((n) => !n.bounds)) return `no box in the snapshot${shadow}`;
	const kept = elements.some((e) => iou(toCss(e), target.rect) >= 0.5);
	if (!kept) {
		const roles = live.map((n) => String(n.role?.value ?? ""));
		if (live.some((n) => n.role?.value === "StaticText")) {
			// the cleaner dropped the text run because a named ancestor already says it
			return `cleaner: text merged into its parent${shadow}`;
		}
		if (live.every((n) => !AX_ONLY_LABEL(n)))
			return `cleaner: unnamed non-control (${[...new Set(roles)].join("/")})${shadow}`;
		return `cleaner: dropped other (${roles.join("/")})${shadow}`;
	}
	if (!picked) return "hit test: nothing";
	const pr = toCss(picked);
	return pr.width * pr.height > target.rect.width * target.rect.height
		? "hit test: a larger element won"
		: "hit test: a smaller element won";
}

async function readScreen() {
	const raw = await session.pageSource();
	const ax = JSON.parse(raw) as WebAxSource;
	if (CORRECT) {
		// DOMSnapshot boxes are in device pixels; this is the fix the lane needs.
		const m = await call("Page.getLayoutMetrics");
		const f = m.layoutViewport.clientWidth / m.cssLayoutViewport.clientWidth;
		for (const n of ax.axTree)
			if (n.bounds)
				n.bounds = {
					x: n.bounds.x / f,
					y: n.bounds.y / f,
					width: n.bounds.width / f,
					height: n.bounds.height / f,
				};
	}
	return { ax, elements: cleanWebAxSource(ax, preset).elements };
}

const report: Json[] = [];
for (const page of PAGES.filter((p) => !pageNames.length || pageNames.includes(p.name))) {
	await session.openUrl(page.url);
	await Bun.sleep(2500);
	if (page.name === "todomvc-react") {
		for (const todo of ["Buy milk", "Walk the dog", "Write the report"]) {
			await evaluate("document.querySelector('.new-todo, #todo-input').focus()");
			await session.type(`${todo}\n`);
		}
		await evaluate("document.querySelector('.toggle')?.click()");
		await Bun.sleep(300);
	}
	const targets = await enumerate();
	const ids = await auditIds();
	const t0 = performance.now();
	const { ax, elements } = await readScreen();
	const readMs = Math.round(performance.now() - t0);
	if (process.env.DEBUG) {
		console.log(
			"viewport",
			await evaluate(
				"JSON.stringify([innerWidth, innerHeight, devicePixelRatio, visualViewport.scale])",
			),
		);
		for (const t of targets.filter((t) => t.frame === "main"))
			console.log(
				"T",
				t.tag,
				JSON.stringify(t.text.slice(0, 20)),
				Math.round(t.rect.x),
				Math.round(t.rect.y),
				Math.round(t.rect.width),
				Math.round(t.rect.height),
			);
		for (const e of elements) {
			const r = toCss(e);
			console.log(
				"E",
				e.type,
				JSON.stringify(e.label.slice(0, 20)),
				Math.round(r.x),
				Math.round(r.y),
				Math.round(r.width),
				Math.round(r.height),
			);
		}
	}

	const counts: Record<string, number> = {};
	const misses: Json[] = [];
	let hits = 0;
	let viaText = 0;
	for (const t of targets) {
		const r = picks(t, elements);
		if (r.ok) {
			hits++;
			if ((r as Json).viaText) viaText++;
			continue;
		}
		const c = cause(t, ax, elements, ids, r.picked);
		counts[c] = (counts[c] ?? 0) + 1;
		misses.push({
			cause: c,
			kind: t.kind,
			tag: t.tag,
			text: t.text,
			frame: t.frame,
			picked: r.picked ? `${r.picked.type} "${r.picked.label.slice(0, 30)}"` : null,
		});
	}
	const byKind = (k: string) => {
		const all = targets.filter((t) => t.kind === k).length;
		const miss = misses.filter((m) => m.kind === k).length;
		return `${all - miss}/${all}`;
	};

	// Timing 1: scroll, then hover against the tree read before it.
	let scroll: Json = null;
	if (page.scroll) {
		await session.swipe(500, 700, 500, 350, 300);
		await Bun.sleep(800);
		const after = await enumerate();
		const fresh = await readScreen();
		const staleHits = after.filter((t) => picks(t, elements).ok).length;
		const freshHits = after.filter((t) => picks(t, fresh.elements).ok).length;
		scroll = { targets: after.length, hitWithStaleTree: staleHits, hitWithFreshTree: freshHits };
	}
	// Timing 2: a screen change in the app, then hover against the tree read before it.
	let change: Json = null;
	if (page.change) {
		const before = page.name === "todomvc-react" ? elements : (await readScreen()).elements;
		await evaluate(page.change);
		await Bun.sleep(500);
		const after = await enumerate();
		const t1 = performance.now();
		const fresh = await readScreen();
		change = {
			targets: after.length,
			hitWithStaleTree: after.filter((t) => picks(t, before).ok).length,
			hitWithFreshTree: after.filter((t) => picks(t, fresh.elements).ok).length,
			treeReadMs: Math.round(performance.now() - t1),
		};
	}

	const entry = {
		page: page.name,
		preset: presetName,
		boxes: CORRECT ? "corrected" : "as shipped",
		targets: targets.length,
		hits,
		controlsPickedByTheirText: viaText,
		controls: byKind("control"),
		text: byKind("text"),
		images: byKind("image"),
		screenElements: elements.length,
		axNodes: ax.axTree.length,
		treeReadMs: readMs,
		missesByCause: counts,
		scroll,
		change,
		misses,
	};
	report.push(entry);
	console.log(JSON.stringify({ ...entry, misses: misses.slice(0, 40) }));
}
await Bun.write(
	join(S, "picks", `report-${presetName}-${CORRECT ? "corrected" : "shipped"}.json`),
	JSON.stringify(report, null, 2),
);

await session.quit();
await client.close().catch(() => {});
proc.kill("SIGTERM");
await Promise.race([proc.exited, Bun.sleep(2000)]);
proc.kill("SIGKILL");
await rm(profileDir, { recursive: true, force: true });
for (const s of [expo, child, fixture]) s.stop(true);
process.exit(0);
