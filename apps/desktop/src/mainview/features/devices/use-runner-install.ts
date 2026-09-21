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
 * Shared ArgentRunner recovery flow. Argent builds and signs its runner
 * automatically on first connect; this dialog is the recovery path when that
 * fails (signing/trust): prompt, explain the trust step, then retry connect.
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
		setMessage("Building and signing ArgentRunner — first connect takes 1–2 minutes.");
		try {
			if (controller.signal.aborted) return;
			const done = current.onInstalled;
			setTarget(null);
			setPhase("prompt");
			setMessage(null);
			toast.success("Retrying connect — Argent builds ArgentRunner automatically…");
			done();
		} catch (error) {
			if (controller.signal.aborted) return;
			setPhase("error");
			setMessage(error instanceof Error ? error.message : "Failed to set up ArgentRunner.");
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
