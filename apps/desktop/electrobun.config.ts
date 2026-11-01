import type { ElectrobunConfig } from "electrobun/bun";
import { executableFileName } from "./src/bun/features/packaged-resources";

// zig-asar unpacks exact paths only, so the compiled names (`.exe` on Windows) must match.
const runnerBin = executableFileName("yoqa-runner");
const cliBin = executableFileName("yoqa");

export default {
	app: {
		name: "yoqa",
		identifier: "ai.yoqa.app",
		version: "1.0.6",
	},
	build: {
		useAsar: true,
		bun: {
			entrypoint: "src/bun/index.ts",
			external: [],
		},
		views: {},
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets/": "views/mainview/assets/",
			[`resources/runner/${runnerBin}`]: `runner/${runnerBin}`,
			[`resources/runner/${cliBin}`]: `runner/${cliBin}`,
			"resources/runner/yoqa-runner-src.tar.gz": "runner/yoqa-runner-src.tar.gz",
			"resources/skills/yoqa-testing.tar.gz": "skills/yoqa-testing.tar.gz",
		},
		asarUnpack: [
			`runner/${runnerBin}`,
			`runner/${cliBin}`,
			"runner/yoqa-runner-src.tar.gz",
			"skills/yoqa-testing.tar.gz",
			"*.node",
			"*.dll",
			"*.dylib",
			"*.so",
		],
		watchIgnore: ["dist/**", "resources/runner/**", "resources/skills/**", "artifacts/**"],
		mac: {
			codesign: false,
			notarize: false,
			bundleCEF: false,
			entitlements: {},
			icons: "assets/icon.iconset",
		},
		linux: {
			bundleCEF: false,
			icon: "assets/icon.png",
		},
		win: {
			bundleCEF: false,
			// A real multi-size ICO: electrobun copies it as Resources/app.ico for the window.
			icon: "assets/icon.ico",
		},
	},
	scripts: {
		preBuild: "scripts/build-runner-sidecar.ts",
		postBuild: "scripts/embed-windows-icon.ts",
	},
	release: {
		baseUrl: "",
		generatePatch: false,
	},
} satisfies ElectrobunConfig;
