import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "yoqa-dia-"));
const proc = Bun.spawn(
	[
		"/Applications/Dia.app/Contents/MacOS/Dia",
		`--user-data-dir=${dir}`,
		"--remote-debugging-port=0",
		"--no-first-run",
		"about:blank",
	],
	{ stdout: "ignore", stderr: "ignore" },
);
let port = "";
for (let i = 0; i < 200 && !port; i++) {
	port =
		(await readFile(join(dir, "User Data/DevToolsActivePort"), "utf8").catch(() => ""))
			.split("\n")[0]
			?.trim() ?? "";
	if (!port) await Bun.sleep(100);
}
for (const wait of [2000, 6000]) {
	await Bun.sleep(wait);
	const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
	console.log(
		`after ${wait} ms:`,
		JSON.stringify(
			list.map((t: { type: string; url: string; title: string }) => ({
				type: t.type,
				url: t.url.slice(0, 80),
				title: t.title.slice(0, 40),
			})),
		),
	);
}
proc.kill("SIGTERM");
await Promise.race([proc.exited, Bun.sleep(2000)]);
proc.kill("SIGKILL");
await rm(dir, { recursive: true, force: true });
