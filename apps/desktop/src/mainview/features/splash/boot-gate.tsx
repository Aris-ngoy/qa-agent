import { getDesktopRpc } from "@/app/desktop-rpc";
import { Button, ProgressCircle } from "@heroui/react";
import { type RuntimeCheck, type RuntimeStatus, createRunnerClient } from "@yoqa/runner-client";
import { type ReactNode, useEffect, useRef, useState } from "react";

type BootPhase = "connecting" | "checking" | "installing" | "ready" | "error";

type ChecklistItemId = "runner" | RuntimeCheck["id"];

type ChecklistItem = {
	id: ChecklistItemId;
	label: string;
	status: "pending" | "active" | "ok" | "warn" | "error";
	detail?: string;
};

const INITIAL_ITEMS: ChecklistItem[] = [
	{ id: "runner", label: "Local runner", status: "pending" },
	{ id: "node", label: "Node.js", status: "pending" },
	{ id: "npm", label: "npm", status: "pending" },
	{ id: "appium", label: "Appium", status: "pending" },
	{ id: "xcuitest", label: "XCUITest driver", status: "pending" },
	{ id: "uiautomator2", label: "UiAutomator2 driver", status: "pending" },
	{ id: "xcode", label: "Xcode", status: "pending" },
	{ id: "adb", label: "Android Debug Bridge", status: "pending" },
];

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyRuntimeChecks(items: ChecklistItem[], status: RuntimeStatus): ChecklistItem[] {
	const byId = new Map(status.checks.map((check) => [check.id, check] as const));
	return items.map((item) => {
		if (item.id === "runner") {
			return { ...item, status: "ok", detail: "Connected" };
		}
		const check = byId.get(item.id);
		if (!check) return item;
		return {
			...item,
			status: check.ok ? "ok" : check.required ? "error" : "warn",
			detail: check.detail,
		};
	});
}

function StatusIcon({ status }: { status: ChecklistItem["status"] }) {
	if (status === "ok") {
		return (
			<span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-primary">
				<svg
					aria-hidden="true"
					className="size-3.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					viewBox="0 0 24 24"
				>
					<path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
		);
	}
	if (status === "error") {
		return (
			<span className="flex size-5 items-center justify-center rounded-full bg-danger/15 text-danger">
				<svg
					aria-hidden="true"
					className="size-3.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.5"
					viewBox="0 0 24 24"
				>
					<path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
		);
	}
	if (status === "warn") {
		return (
			<span className="flex size-5 items-center justify-center rounded-full bg-warning/20 text-on-surface-variant">
				<svg
					aria-hidden="true"
					className="size-3.5"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					viewBox="0 0 24 24"
				>
					<path
						d="M12 9v4M12 17h.01M10.3 4.3L2.6 18a2 2 0 001.7 3h15.4a2 2 0 001.7-3L13.7 4.3a2 2 0 00-3.4 0z"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			</span>
		);
	}
	if (status === "active") {
		return (
			<ProgressCircle
				aria-label="Checking"
				className="size-5 text-on-surface-variant"
				isIndeterminate
				size="sm"
			>
				<ProgressCircle.Track>
					<ProgressCircle.TrackCircle className="stroke-outline-variant" />
					<ProgressCircle.FillCircle className="stroke-on-surface-variant" />
				</ProgressCircle.Track>
			</ProgressCircle>
		);
	}
	return <span className="size-5 rounded-full border border-outline-variant/70" />;
}

type SplashScreenProps = {
	phase: BootPhase;
	items: ChecklistItem[];
	message: string | null;
	onRetry: () => void;
};

function SplashScreen({ phase, items, message, onRetry }: SplashScreenProps) {
	const busy = phase === "connecting" || phase === "checking" || phase === "installing";

	return (
		<div className="dashboard-canvas electrobun-webkit-app-region-drag flex h-full min-h-0 items-center justify-center px-6 pt-10 pb-8">
			<section className="electrobun-webkit-app-region-no-drag w-full max-w-lg rounded-[var(--radius-platform)] bg-surface-container-lowest px-8 py-10 shadow-soft">
				<div className="mb-8 flex flex-col items-center text-center">
					<span className="mb-5 flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-card-lavender to-card-rose text-2xl font-bold text-primary shadow-card">
						Y
					</span>
					<h1 className="text-headline-lg font-semibold tracking-tight text-on-surface">YoQA</h1>
					<p className="mt-2 text-body-md text-on-surface-variant">
						{phase === "connecting"
							? "Connecting to the local runner…"
							: phase === "checking"
								? "Checking test runtime…"
								: phase === "installing"
									? "Installing missing drivers…"
									: phase === "error"
										? "Couldn’t finish setup"
										: "Ready"}
					</p>
				</div>

				<ul className="space-y-2.5">
					{items.map((item) => (
						<li
							className="flex items-start gap-3 rounded-xl bg-surface-container-low/70 px-3.5 py-2.5"
							key={item.id}
						>
							<div className="mt-0.5 shrink-0">
								<StatusIcon status={item.status} />
							</div>
							<div className="min-w-0 flex-1">
								<p className="text-body-md font-medium text-on-surface">{item.label}</p>
								{item.detail ? (
									<p
										className={`truncate text-helper ${
											item.status === "error" ? "text-danger" : "text-on-surface-variant"
										}`}
									>
										{item.detail}
									</p>
								) : null}
							</div>
						</li>
					))}
				</ul>

				{busy ? (
					<p className="mt-6 text-center text-body-sm text-on-surface-variant">
						First launch can take 1–2 minutes
					</p>
				) : null}

				{phase === "error" ? (
					<div className="mt-6 flex flex-col items-center gap-3">
						{message ? <p className="text-center text-body-sm text-danger">{message}</p> : null}
						<Button className="rounded-full" onPress={onRetry} variant="primary">
							Retry
						</Button>
					</div>
				) : null}
			</section>
		</div>
	);
}

type BootGateProps = {
	children: ReactNode;
};

export function BootGate({ children }: BootGateProps) {
	const [phase, setPhase] = useState<BootPhase>("connecting");
	const [items, setItems] = useState<ChecklistItem[]>(INITIAL_ITEMS);
	const [message, setMessage] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [ready, setReady] = useState(false);
	const abortRef = useRef<AbortController | null>(null);

	const retry = () => {
		abortRef.current?.abort();
		setReady(false);
		setPhase("connecting");
		setItems(INITIAL_ITEMS);
		setMessage(null);
		setAttempt((n) => n + 1);
	};

	useEffect(() => {
		void attempt;
		const controller = new AbortController();
		abortRef.current = controller;

		void (async () => {
			try {
				setPhase("connecting");
				setItems((prev) =>
					prev.map((item) =>
						item.id === "runner"
							? { ...item, status: "active", detail: "Waiting for runner…" }
							: { ...item, status: "pending", detail: undefined },
					),
				);

				const baseUrl = await getDesktopRpc().request.getRunnerBaseUrl();
				const client = createRunnerClient({ baseUrl });

				let healthy = false;
				for (let i = 0; i < 30; i++) {
					if (controller.signal.aborted) return;
					try {
						await client.health();
						healthy = true;
						break;
					} catch {
						await sleep(500);
					}
				}

				if (!healthy) {
					throw new Error("Local runner is offline. Start it with `bun run runner`.");
				}

				if (controller.signal.aborted) return;

				setItems((prev) =>
					prev.map((item) =>
						item.id === "runner" ? { ...item, status: "ok", detail: "Connected" } : item,
					),
				);

				setPhase("checking");
				setItems((prev) =>
					prev.map((item) =>
						item.id === "runner" ? item : { ...item, status: "active", detail: "Checking…" },
					),
				);

				let status = await client.getRuntimeStatus({ signal: controller.signal });
				if (controller.signal.aborted) return;

				setItems((prev) => applyRuntimeChecks(prev, status));

				if (!status.ready) {
					setPhase("installing");
					setItems((prev) =>
						prev.map((item) => {
							if (item.id === "runner" || item.status === "ok") return item;
							if (item.id === "xcode" || item.id === "adb") return item;
							return { ...item, status: "active", detail: "Installing…" };
						}),
					);

					const ensured = await client.ensureRuntime({ signal: controller.signal });
					if (controller.signal.aborted) return;
					status = ensured.status;
					setItems((prev) => applyRuntimeChecks(prev, status));
				}

				if (!status.ready) {
					const failed = status.checks
						.filter((check) => check.required && !check.ok)
						.map((check) => check.label);
					throw new Error(`Missing required tools: ${failed.join(", ")}`);
				}

				setPhase("ready");
				// Brief beat so the checklist reads as complete before entering the app.
				await sleep(350);
				if (controller.signal.aborted) return;
				setReady(true);
			} catch (error) {
				if (controller.signal.aborted) return;
				const text = error instanceof Error ? error.message : "Boot checks failed.";
				setPhase("error");
				setMessage(text);
				setItems((prev) =>
					prev.map((item) =>
						item.status === "active" || item.status === "pending"
							? { ...item, status: "error", detail: item.detail ?? "Interrupted" }
							: item,
					),
				);
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
		return <SplashScreen items={items} message={message} onRetry={retry} phase={phase} />;
	}

	return children;
}
