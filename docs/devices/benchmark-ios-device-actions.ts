import { performActionWithScreenshot } from "../../services/runner/src/domains/devices/action-result";
import {
	defaultLanesFor,
	openDeviceSession,
} from "../../services/runner/src/domains/devices/open-session";
const [deviceId, lane, n] = [
	process.argv[2],
	process.argv[3] as "appium" | "direct",
	Number(process.argv[4] ?? 10),
];
const lanes = defaultLanesFor("ios");
const t0 = performance.now();
const s = await openDeviceSession(
	{ platform: "ios", deviceId, appCaps: [], caseCaps: [], requestedLane: lane },
	lanes,
);
const coldStart = Math.round(performance.now() - t0);
const total: number[] = [];
const action: number[] = [];
const settle: number[] = [];
let shot = 0;
for (let i = 0; i < n + 1; i++) {
	const t = performance.now();
	const r = await performActionWithScreenshot(s, {
		kind: "tap",
		x: 500,
		y: 500,
		screenshot: true,
	} as never);
	const ms = Math.round(performance.now() - t);
	if (i === 0) continue; // warm-up
	total.push(ms);
	action.push(r.phases?.actionMs ?? 0);
	settle.push(r.phases?.settleMs ?? 0);
}
const t1 = performance.now();
await s.captureFrame();
shot = Math.round(performance.now() - t1);
await s.quit();
const q = (a: number[], p: number) =>
	[...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)];
console.log(
	JSON.stringify(
		{
			lane: s.lane,
			laneWarning: s.laneWarning,
			deviceId,
			repeats: n,
			coldStartMs: coldStart,
			tapToResultMs: { p50: q(total, 0.5), p95: q(total, 0.95), samples: total },
			actionMs: { p50: q(action, 0.5) },
			settleMs: { p50: q(settle, 0.5) },
			frameCaptureMs: shot,
		},
		null,
		2,
	),
);
process.exit(0);
