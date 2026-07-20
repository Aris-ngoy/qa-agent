import type { ElectrobunConfig } from "electrobun/bun";

export default {
	app: {
		name: "qa-agent",
		identifier: "dev.qa-agent.app",
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
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
	release: {
		baseUrl: "",
	},
} satisfies ElectrobunConfig;
