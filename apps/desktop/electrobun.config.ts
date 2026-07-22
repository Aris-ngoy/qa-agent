import type { ElectrobunConfig } from "electrobun/bun";

export default {
	app: {
		name: "yoqa",
		identifier: "ai.yoqa.app",
		version: "0.1.0",
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
		},
		watchIgnore: ["dist/**"],
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
	release: {
		baseUrl: "",
	},
} satisfies ElectrobunConfig;
