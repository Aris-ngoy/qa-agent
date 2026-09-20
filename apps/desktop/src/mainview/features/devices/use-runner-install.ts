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
 * Shared YoqaADRunner install flow. Check-and-install runs inside connect on
 * the runner; this dialog is the recovery path when that fails: prompt,
 * run the long install, then retry the original action.
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

	const runInstall = useCallback(async (current: RunnerInstallTarget) => {
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
	}, []);

	const startRunnerInstall = useCallback(async () => {
		const current = target;
		if (!current) return;
		await runInstall(current);
	}, [target, runInstall]);

	return {
		runnerInstallTarget: target,
		runnerInstallPhase: phase,
		runnerInstallMessage: message,
		openRunnerInstall,
		closeRunnerInstall,
		startRunnerInstall,
	};
}
