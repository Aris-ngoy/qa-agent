import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const workspacePackages = path.resolve(rootDir, "../../packages");

export default defineConfig({
	plugins: [react(), tailwindcss()],
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
		fs: {
			allow: [rootDir, workspacePackages],
		},
	},
});
