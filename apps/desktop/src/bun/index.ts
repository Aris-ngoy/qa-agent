import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { DesktopRPC } from "../shared/rpc";
import { getIosToolchainSnapshot, setIosToolchainSelection } from "./features/ios-toolchain";

async function getMainViewUrl(): Promise<string> {
	const viteUrl = "http://localhost:5173";
	// Retry briefly so electrobun relaunches still pick up an already-running Vite
	for (let attempt = 0; attempt < 10; attempt++) {
		try {
			const response = await fetch(viteUrl);
			if (response.ok) {
				console.log("[qa-agent desktop] loading UI from Vite HMR", viteUrl);
				return viteUrl;
			}
		} catch {
			// Vite HMR server not ready yet
		}
		await Bun.sleep(100);
	}
	console.log("[qa-agent desktop] Vite HMR unavailable — using bundled views");
	return "views://mainview/index.html";
}

ApplicationMenu.setApplicationMenu([
	{
		submenu: [
			{ label: "About qa-agent", role: "about" },
			{ type: "separator" },
			{ label: "Quit", role: "quit", accelerator: "q" },
		],
	},
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
]);

const mainRPC = BrowserView.defineRPC<DesktopRPC>({
	maxRequestTime: 30_000,
	handlers: {
		requests: {
			ping: () => "pong",
			getRunnerBaseUrl: () => process.env.QA_AGENT_RUNNER_URL ?? "http://127.0.0.1:7420",
			getIosToolchain: () => getIosToolchainSnapshot(),
			setIosToolchainSelection: (params) => setIosToolchainSelection(params),
		},
		messages: {
			log: ({ msg }) => {
				console.log("[webview]", msg);
			},
		},
	},
});

const mainWindow = new BrowserWindow({
	title: "qa-agent",
	url: await getMainViewUrl(),
	// Transparent titlebar so the app canvas paints under the traffic lights
	titleBarStyle: "hiddenInset",
	frame: {
		width: 1100,
		height: 720,
		x: 80,
		y: 80,
	},
	rpc: mainRPC,
});

mainWindow.on("close", () => {
	process.exit(0);
});

console.log("[qa-agent desktop] started");
