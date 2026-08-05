import type { ElectrobunConfig } from "electrobun/bun";

export default {
	app: {
		name: "yoqa",
		identifier: "ai.yoqa.app",
		version: "0.2.0",
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
			"resources/runner/yoqa-runner": "runner/yoqa-runner",
		},
		asarUnpack: ["runner/yoqa-runner", "*.node", "*.dll", "*.dylib", "*.so"],
		watchIgnore: ["dist/**", "resources/runner/**", "artifacts/**"],
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
			icon: "assets/icon.png",
		},
	},
	scripts: {
		preBuild: "scripts/build-runner-sidecar.ts",
	},
	release: {
		baseUrl: "",
		generatePatch: false,
	},
} satisfies ElectrobunConfig;
