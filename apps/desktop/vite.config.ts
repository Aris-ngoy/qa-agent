import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const workspacePackages = path.resolve(rootDir, "../../packages");

/** Dev only: print the webview's `devLog`/`devError` lines (sent over the HMR socket) here. */
function webviewDevLog(): Plugin {
	return {
		name: "yoqa-webview-dev-log",
		apply: "serve",
		configureServer(server) {
			server.ws.on(
				"yoqa:dev-log",
				(payload: { level?: string; message?: string; data?: unknown }) => {
					const data =
						payload.data === undefined ? "" : ` ${JSON.stringify(payload.data, null, 2)}`;
					const line = `[yoqa:webview] ${payload.message ?? ""}${data}`;
					if (payload.level === "error") console.error(line);
					else console.log(line);
				},
			);
		},
	};
}

export default defineConfig({
	plugins: [
		// React Compiler memoizes components and hooks at build time (React 19 target).
		react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
		tailwindcss(),
		webviewDevLog(),
	],
	base: "./",
	resolve: {
		// Point at package sources so HMR watches them (not node_modules symlinks)
		alias: {
			"@": path.resolve(rootDir, "src/mainview"),
			"@yoqa/ui/styles.css": path.resolve(workspacePackages, "ui/src/styles.css"),
			"@yoqa/ui": path.resolve(workspacePackages, "ui/src"),
			"@yoqa/runner-client": path.resolve(workspacePackages, "runner-client/src"),
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
	server: {
		port: 5173,
		strictPort: true,
		watch: {
			// electrobun writes temp `.bun-build` files and its build output next to this config;
			// Windows locks them while they are written, and watching them crashes Vite with EBUSY.
			ignored: ["**/*.bun-build", "**/build/**"],
		},
		fs: {
			// Monorepo: deps are hoisted to the repo root node_modules
			allow: [rootDir, workspacePackages, path.resolve(rootDir, "../..")],
		},
	},
});
