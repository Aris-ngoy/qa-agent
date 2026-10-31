/** How long the runner waits for its sessions to quit before it exits anyway. */
export const STOP_CAP_MS = 5_000;

export type StopRunnerDeps = {
	/** Quit everything Yoqa launched: the Active Session and any session a Run holds. */
	quit: () => Promise<void>;
	exit: (code: number) => void;
	capMs?: number;
	log?: (message: string) => void;
};

/**
 * The runner's SIGINT/SIGTERM handler. The first signal quits the sessions, waiting for
 * them up to `capMs`, then exits: 0 once they quit, 1 when the cap ran out. A second
 * signal while quitting exits at once with 130.
 */
export function stopRunner(deps: StopRunnerDeps): (signal: string) => void {
	const capMs = deps.capMs ?? STOP_CAP_MS;
	const log = deps.log ?? ((message) => console.log(message));
	let stopping = false;
	return (signal) => {
		if (stopping) {
			log(`[yoqa-runner] ${signal} again — exiting without waiting`);
			deps.exit(130);
			return;
		}
		stopping = true;
		log(`[yoqa-runner] ${signal} — quitting device sessions, then stopping`);
		let timer: ReturnType<typeof setTimeout> | undefined;
		const capped = new Promise<"cap">((resolve) => {
			timer = setTimeout(() => resolve("cap"), capMs);
		});
		const quit = deps
			.quit()
			.catch((error: unknown) => {
				log(
					`[yoqa-runner] could not quit device sessions: ${error instanceof Error ? error.message : String(error)}`,
				);
			})
			.then(() => "quit" as const);
		void Promise.race([quit, capped]).then((outcome) => {
			clearTimeout(timer);
			if (outcome === "quit") {
				deps.exit(0);
				return;
			}
			log(`[yoqa-runner] device sessions did not quit within ${capMs} ms — stopping anyway`);
			deps.exit(1);
		});
	};
}
