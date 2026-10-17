import { useReducedMotion } from "@/app/motion/use-reduced-motion";
import { YoqaMark } from "@/features/splash/components/yoqa-mark";
import { sleep, startLocalServices } from "@/features/splash/data/api/boot";
import { type BootPhase, initialBootState } from "@/features/splash/data/state/boot";
import { Button } from "@heroui/react";
import { batch } from "@legendapp/state";
import { useObservable, useValue } from "@legendapp/state/react";
import { type ReactNode, useEffect, useRef } from "react";

const CROSSFADE_MS = 400;

function splashForPhase(
	phase: BootPhase,
	message: string | null,
): { progress: number; statusText: string } {
	switch (phase) {
		case "starting":
			return { progress: 30, statusText: "Starting local services..." };
		case "checking":
			return { progress: 70, statusText: "Checking the local runner..." };
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
		<div className="electrobun-webkit-app-region-drag flex h-full min-h-0 flex-col bg-splash px-8 pt-12 pb-8 text-on-splash">
			<div className="flex flex-1 flex-col items-center justify-center">
				<div className="flex w-full max-w-[280px] flex-col items-center">
					<YoqaMark className={phase === "ready" ? "mb-5 motion-fade-in" : "mb-5"} />
					<p className="text-center text-body-md text-splash-muted">Local QA host · Workspace</p>

					<div className="mt-11 w-full max-w-[160px]">
						<div
							aria-valuemax={100}
							aria-valuemin={0}
							aria-valuenow={progress}
							className="h-1 w-full overflow-hidden rounded-sm bg-splash-track"
							role="progressbar"
							tabIndex={-1}
						>
							<div
								className="h-full rounded-sm bg-splash-accent transition-[width] duration-500 ease-out"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<p
							className={`mt-3.5 text-center text-body-sm ${
								isError ? "text-danger" : "text-splash-subtle"
							}`}
						>
							{statusText}
						</p>
					</div>

					{isError ? (
						<div className="electrobun-webkit-app-region-no-drag mt-6 flex flex-col items-center">
							<Button
								className="rounded-full bg-splash-accent text-splash"
								onPress={onRetry}
								variant="primary"
							>
								Retry
							</Button>
						</div>
					) : null}
				</div>
			</div>

			<p className="text-center text-helper text-splash-faint">Phase 1 · local only</p>
		</div>
	);
}

type BootGateProps = {
	children: ReactNode;
};

export function BootGate({ children }: BootGateProps) {
	const reducedMotion = useReducedMotion();
	const boot$ = useObservable(initialBootState());
	const phase = useValue(boot$.phase);
	const message = useValue(boot$.message);
	const attempt = useValue(boot$.attempt);
	const ready = useValue(boot$.ready);
	const splashMounted = useValue(boot$.splashMounted);
	const splashExiting = useValue(boot$.splashExiting);
	const appVisible = useValue(boot$.appVisible);
	const abortRef = useRef<AbortController | null>(null);

	const retry = () => {
		abortRef.current?.abort();
		boot$.set(initialBootState(boot$.attempt.peek() + 1));
	};

	useEffect(() => {
		void attempt;
		const controller = new AbortController();
		abortRef.current = controller;

		void (async () => {
			try {
				boot$.phase.set("starting");
				if (!(await startLocalServices(controller.signal))) return;
				if (controller.signal.aborted) return;

				boot$.phase.set("checking");

				boot$.phase.set("ready");
				await sleep(350);
				if (controller.signal.aborted) return;
				boot$.ready.set(true);
			} catch (error) {
				if (controller.signal.aborted) return;
				const text = error instanceof Error ? error.message : "Boot checks failed.";
				batch(() => {
					boot$.phase.set("error");
					boot$.message.set(text);
				});
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
				}
			}
		})();

		return () => {
			controller.abort();
		};
	}, [attempt, boot$]);

	useEffect(() => {
		if (!ready) return;

		if (reducedMotion) {
			batch(() => {
				boot$.appVisible.set(true);
				boot$.splashMounted.set(false);
				boot$.splashExiting.set(false);
			});
			return;
		}

		batch(() => {
			boot$.appVisible.set(false);
			boot$.splashExiting.set(false);
			boot$.splashMounted.set(true);
		});

		const showApp = window.requestAnimationFrame(() => {
			batch(() => {
				boot$.appVisible.set(true);
				boot$.splashExiting.set(true);
			});
		});

		const done = window.setTimeout(() => {
			boot$.splashMounted.set(false);
		}, CROSSFADE_MS);

		return () => {
			window.cancelAnimationFrame(showApp);
			window.clearTimeout(done);
		};
	}, [ready, reducedMotion, boot$]);

	if (!ready) {
		return <SplashScreen message={message} onRetry={retry} phase={phase} />;
	}

	return (
		<div className="boot-crossfade-root">
			<div className={`boot-app-layer${appVisible || reducedMotion ? " is-visible" : ""}`}>
				{children}
			</div>
			{splashMounted ? (
				<div className={`boot-splash-layer${splashExiting ? " is-exiting" : ""}`}>
					<SplashScreen message={message} onRetry={retry} phase={phase} />
				</div>
			) : null}
		</div>
	);
}
