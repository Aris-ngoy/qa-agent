import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vite";
import { WEB_PORT } from "./e2e/harness";
import baseConfig from "./vite.config";

/** The webview for the Playwright e2e: the desktop host RPC is swapped for a stub. */
export default mergeConfig(
	baseConfig,
	defineConfig({
		resolve: {
			// Array form, so this alias is matched before the base config's "@".
			alias: [
				{
					find: "@/app/desktop-rpc",
					replacement: fileURLToPath(new URL("./e2e/stub-desktop-rpc.ts", import.meta.url)),
				},
			],
		},
		server: { port: WEB_PORT, strictPort: true },
	}),
);
