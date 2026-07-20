import { ApplicationMenu, BrowserView, BrowserWindow } from "electrobun/bun";
import type { DesktopRPC } from "../shared/rpc";

async function getMainViewUrl(): Promise<string> {
	try {
		const response = await fetch("http://localhost:5173");
		if (response.ok) {
			return "http://localhost:5173";
		}
	} catch {
		// Vite HMR server not running — use bundled views
	}
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
	maxRequestTime: 5000,
	handlers: {
		requests: {
			ping: () => "pong",
			getRunnerBaseUrl: () => process.env.QA_AGENT_RUNNER_URL ?? "http://127.0.0.1:7420",
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
