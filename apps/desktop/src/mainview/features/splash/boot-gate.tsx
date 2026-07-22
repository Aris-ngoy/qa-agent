import { getDesktopRpc } from "@/app/desktop-rpc";
import { Button } from "@heroui/react";
import { createRunnerClient } from "@yoqa/runner-client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { YoqaMark } from "./yoqa-mark";

type BootPhase = "starting" | "checking" | "installing" | "ready" | "error";

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function splashForPhase(
	phase: BootPhase,
	message: string | null,
): { progress: number; statusText: string } {
	switch (phase) {
		case "starting":
			return { progress: 30, statusText: "Starting local services..." };
		case "checking":
			return { progress: 55, statusText: "Checking test runtime..." };
		case "installing":
			return { progress: 80, statusText: "Installing missing drivers..." };
		case "ready":
			return { progress: 100, statusText: "Ready" };
		case "error":
			return { progress: 0, statusText: message ?? "Couldn’t finish setup" };
	}
}

type SplashScreenProps = {
	phase: BootPhase;
	message: string | null;
	onRetry: () => void;
};

function SplashScreen({ phase, message, onRetry }: SplashScreenProps) {
	const { progress, statusText } = splashForPhase(phase, message);
	const isError = phase === "error";

	return (
		<div className="electrobun-webkit-app-region-drag flex h-full min-h-0 flex-col bg-[#14131c] px-8 pt-12 pb-8 text-white">
			<div className="flex flex-1 flex-col items-center justify-center">
				<div className="flex w-full max-w-[280px] flex-col items-center">
					<YoqaMark className="mb-5" />
					<p className="text-center text-body-md text-[#8a8792]">Local QA host · Workspace</p>

					<div className="mt-11 w-full max-w-[160px]">
						<div
							aria-valuemax={100}
							aria-valuemin={0}
							aria-valuenow={progress}
							className="h-1 w-full overflow-hidden rounded-sm bg-[#2a2836]"
							role="progressbar"
							tabIndex={-1}
						>
							<div
								className="h-full rounded-sm bg-[#e3dbf7] transition-[width] duration-500 ease-out"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<p
							className={`mt-3.5 text-center text-body-sm ${
								isError ? "text-danger" : "text-[#7d7889]"
							}`}
						>
							{statusText}
						</p>
					</div>

					{isError ? (
						<div className="electrobun-webkit-app-region-no-drag mt-6 flex flex-col items-center">
							<Button
								className="rounded-full bg-[#e3dbf7] text-[#14131c]"
								onPress={onRetry}
								variant="primary"
							>
								Retry
							</Button>
						</div>
					) : null}
				</div>
			</div>

			<p className="text-center text-helper text-[#5c5865]">Phase 1 · local only</p>
		</div>
	);
}

type BootGateProps = {
	children: ReactNode;
};

export function BootGate({ children }: BootGateProps) {
	const [phase, setPhase] = useState<BootPhase>("starting");
	const [message, setMessage] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [ready, setReady] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	const retry = () => {
		abortRef.current?.abort();
		setReady(false);
		setPhase("starting");
		setMessage(null);
		setAttempt((n) => n + 1);
	};

	useEffect(() => {
		void attempt;
		const controller = new AbortController();
		abortRef.current = controller;

		void (async () => {
			try {
				setPhase("starting");

				const { baseUrl } = await getDesktopRpc().request.ensureLocalServices();
				if (controller.signal.aborted) return;

				const client = createRunnerClient({ baseUrl });

				// Confirm the sidecar is reachable from the webview (CORS / loopback).
				let healthy = false;
				for (let i = 0; i < 20; i++) {
					if (controller.signal.aborted) return;
					try {
						await client.health();
						healthy = true;
						break;
					} catch {
						await sleep(250);
					}
				}

				if (!healthy) {
					throw new Error("Local runner started but is not reachable yet. Retry.");
				}

				if (controller.signal.aborted) return;

				setPhase("checking");

				let status = await client.getRuntimeStatus({ signal: controller.signal });
				if (controller.signal.aborted) return;

				if (!status.ready) {
					setPhase("installing");

					const ensured = await client.ensureRuntime({ signal: controller.signal });
					if (controller.signal.aborted) return;
					status = ensured.status;
				}

				if (!status.ready) {
					const failed = status.checks
						.filter((check) => check.required && !check.ok)
						.map((check) => check.label);
					throw new Error(`Missing required tools: ${failed.join(", ")}`);
				}

				setPhase("ready");
				await sleep(350);
				if (controller.signal.aborted) return;
				setReady(true);
			} catch (error) {
				if (controller.signal.aborted) return;
				const text = error instanceof Error ? error.message : "Boot checks failed.";
				setPhase("error");
				setMessage(text);
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
				}
			}
		})();

		return () => {
			controller.abort();
		};
	}, [attempt]);

	if (!ready) {
		return <SplashScreen message={message} onRetry={retry} phase={phase} />;
	}

	return children;
}
