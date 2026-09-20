import { getRunnerClient } from "@/app/runner-client";
import type { SelectedDevice } from "@/features/devices/select-device-modal";
import { toast } from "@heroui/react";
import { useCallback, useRef, useState } from "react";
import type { RunnerInstallPhase } from "./runner-install-dialog";

type RunnerInstallTarget = {
	device: SelectedDevice;
	/** Connect failure detail shown under the prompt copy */
	detail: string | null;
	/** Runs after a successful install (usually: retry the connect) */
	onInstalled: () => void;
};

/**
 * Shared YoqaADRunner install flow: open the dialog on a runner-missing
 * connect failure, run the long install, then retry the original action.
 */
export function useRunnerInstall() {
	const [target, setTarget] = useState<RunnerInstallTarget | null>(null);
	const [phase, setPhase] = useState<RunnerInstallPhase>("prompt");
	const [message, setMessage] = useState<string | null>(null);
	const abortRef = useRef<AbortController | null>(null);

	const openRunnerInstall = useCallback(
		(device: SelectedDevice, detail: string | null, onInstalled: () => void) => {
			abortRef.current?.abort();
			abortRef.current = null;
			setTarget({ device, detail, onInstalled });
			setPhase("prompt");
			setMessage(detail);
		},
		[],
	);

	const closeRunnerInstall = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
		setTarget(null);
		setPhase("prompt");
		setMessage(null);
	}, []);

	/**
	 * Proactive runner check for the play flow: returns true when the run may
	 * proceed. When the iOS runner is missing it opens the install dialog and
	 * returns false — the caller must not start the run; `onInstalled` retries it.
	 * Status-check failures fall through (return true) so the existing
	 * run-failure handling stays authoritative.
	 */
	const ensureRunnerInstalled = useCallback(
		async (device: SelectedDevice, onInstalled: () => void): Promise<boolean> => {
			if (device.platform !== "ios") return true;
			try {
				const client = await getRunnerClient();
				const status = await client.getIosRunnerStatus(device.id, device.kind);
				if (status.installed) return true;
			} catch {
				return true;
			}
			openRunnerInstall(
				device,
				"YoqaADRunner is not installed on this device yet. Install it first, then the run starts automatically.",
				onInstalled,
			);
			return false;
		},
		[openRunnerInstall],
	);

	const startRunnerInstall = useCallback(async () => {
		const current = target;
		if (!current) return;
		const controller = new AbortController();
		abortRef.current = controller;
		setPhase("installing");
		setMessage("Building and signing YoqaADRunner — first install takes 1–2 minutes.");
		try {
			const client = await getRunnerClient();
			const result = await client.installIosRunner(
				{ deviceId: current.device.id, kind: current.device.kind },
				{ signal: controller.signal },
			);
			if (controller.signal.aborted) return;
			const done = current.onInstalled;
			setTarget(null);
			setPhase("prompt");
			setMessage(null);
			toast.success(
				[
					result.action === "reused"
						? "YoqaADRunner already installed — reconnecting…"
						: "YoqaADRunner installed — reconnecting…",
					result.removedStale.length > 0
						? `Removed old copies: ${result.removedStale.join(", ")}.`
						: null,
					result.warning ?? null,
				]
					.filter(Boolean)
					.join(" "),
			);
			done();
		} catch (error) {
			if (controller.signal.aborted) return;
			setPhase("error");
			setMessage(error instanceof Error ? error.message : "Failed to install YoqaADRunner.");
		} finally {
			if (abortRef.current === controller) abortRef.current = null;
		}
	}, [target]);

	return {
		runnerInstallTarget: target,
		runnerInstallPhase: phase,
		runnerInstallMessage: message,
		openRunnerInstall,
		closeRunnerInstall,
		ensureRunnerInstalled,
		startRunnerInstall,
	};
}
