import { getDesktopRpc } from "@/app/desktop-rpc";
import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { Button } from "@heroui/react";
import { createRunnerClient } from "@yoqa/runner-client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { YoqaMark } from "./yoqa-mark";

type BootPhase = "starting" | "checking" | "prompt" | "installing" | "ready" | "error";

const CROSSFADE_MS = 400;

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
		case "prompt":
			return { progress: 65, statusText: "Argent is not installed" };
		case "installing":
			return { progress: 80, statusText: "Installing Argent..." };
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
	onInstall: () => void;
	onDecline: () => void;
};

function SplashScreen({ phase, message, onRetry, onInstall, onDecline }: SplashScreenProps) {
	const { progress, statusText } = splashForPhase(phase, message);
	const isError = phase === "error";
	const isPrompt = phase === "prompt";

	return (
		<div className="electrobun-webkit-app-region-drag flex h-full min-h-0 flex-col bg-[#14131c] px-8 pt-12 pb-8 text-white">
			<div className="flex flex-1 flex-col items-center justify-center">
				<div className="flex w-full max-w-[280px] flex-col items-center">
					<YoqaMark className={phase === "ready" ? "mb-5 motion-fade-in" : "mb-5"} />
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

					{isPrompt ? (
						<div className="electrobun-webkit-app-region-no-drag mt-6 flex w-full max-w-[280px] flex-col items-center gap-3">
							<p className="text-center text-body-sm text-[#8a8792]">
								{message ??
									"Yoqa drives devices through Argent. Install it globally? (npm install -g @swmansion/argent, then argent init --global)"}
							</p>
							<p className="text-center text-helper text-[#5c5865]">
								Includes Argent's proprietary device binaries (use-only, no redistribution).
								Telemetry is opt-out: argent telemetry disable.
							</p>
							<Button
								className="rounded-full bg-[#e3dbf7] text-[#14131c]"
								onPress={onInstall}
								variant="primary"
							>
								Install Argent
							</Button>
							<Button onPress={onDecline} variant="secondary">
								Not now
							</Button>
						</div>
					) : null}

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
	const reducedMotion = useReducedMotion();
	const [phase, setPhase] = useState<BootPhase>("starting");
	const [message, setMessage] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [ready, setReady] = useState(false);
	const [splashMounted, setSplashMounted] = useState(true);
	const [splashExiting, setSplashExiting] = useState(false);
	const [appVisible, setAppVisible] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const consentRef = useRef(false);

	const retry = () => {
		abortRef.current?.abort();
		consentRef.current = false;
		setReady(false);
		setSplashMounted(true);
		setSplashExiting(false);
		setAppVisible(false);
		setPhase("starting");
		setMessage(null);
		setAttempt((n) => n + 1);
	};

	const install = () => {
		// Explicit consent for the global install — the boot effect picks it
		// up and calls ensure with { consent: true }.
		consentRef.current = true;
		setPhase("installing");
		setMessage(null);
		setAttempt((n) => n + 1);
	};

	const decline = () => {
		// Limited boot: app opens, device features gate on runtime status
		// (Devices screens + Settings offer retry).
		setPhase("ready");
		setMessage("Argent not installed — device features are unavailable.");
		setReady(true);
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
					const argentMissing = status.checks.some(
						(check) => check.id === "argent" && check.required && !check.ok,
					);
					if (argentMissing && !consentRef.current) {
						// Never install globally without consent — prompt first.
						setPhase("prompt");
						setMessage(
							status.checks.find((check) => check.id === "argent")?.detail ??
								"Argent is not installed.",
						);
						return;
					}
					setPhase("installing");

					const ensured = await client.ensureRuntime({
						signal: controller.signal,
						consent: consentRef.current,
					});
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

	useEffect(() => {
		if (!ready) return;

		if (reducedMotion) {
			setAppVisible(true);
			setSplashMounted(false);
			setSplashExiting(false);
			return;
		}

		setAppVisible(false);
		setSplashExiting(false);
		setSplashMounted(true);

		const showApp = window.requestAnimationFrame(() => {
			setAppVisible(true);
			setSplashExiting(true);
		});

		const done = window.setTimeout(() => {
			setSplashMounted(false);
		}, CROSSFADE_MS);

		return () => {
			window.cancelAnimationFrame(showApp);
			window.clearTimeout(done);
		};
	}, [ready, reducedMotion]);

	if (!ready) {
		return (
			<SplashScreen
				message={message}
				onDecline={decline}
				onInstall={install}
				onRetry={retry}
				phase={phase}
			/>
		);
	}

	return (
		<div className="boot-crossfade-root">
			<div className={`boot-app-layer${appVisible || reducedMotion ? " is-visible" : ""}`}>
				{children}
			</div>
			{splashMounted ? (
				<div className={`boot-splash-layer${splashExiting ? " is-exiting" : ""}`}>
					<SplashScreen
						message={message}
						onDecline={decline}
						onInstall={install}
						onRetry={retry}
						phase={phase}
					/>
				</div>
			) : null}
		</div>
	);
}
