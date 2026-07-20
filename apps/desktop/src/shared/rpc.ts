export type DesktopRPC = {
	bun: {
		requests: {
			ping: {
				params: undefined;
				response: string;
			};
			getRunnerBaseUrl: {
				params: undefined;
				response: string;
			};
		};
		messages: {
			log: { msg: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: Record<string, never>;
	};
};
