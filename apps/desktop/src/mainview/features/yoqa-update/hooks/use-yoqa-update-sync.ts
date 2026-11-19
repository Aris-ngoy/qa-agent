import { useEffect } from "react";
import { getYoqaUpdateStatus, onYoqaUpdateStatus } from "../data/api/yoqa-update";
import { setYoqaUpdateStatus } from "../data/state/yoqa-update";

/** Mirror the Bun host's Yoqa update snapshot into `yoqaUpdate$`: one read, then every push. */
export function useYoqaUpdateSync(): void {
	useEffect(() => {
		let pushed = false;
		const unsubscribe = onYoqaUpdateStatus((status) => {
			pushed = true;
			setYoqaUpdateStatus(status);
		});
		void getYoqaUpdateStatus()
			.then((status) => {
				// A push that landed first is newer than this read.
				if (!pushed) setYoqaUpdateStatus(status);
			})
			.catch(() => {});
		return unsubscribe;
	}, []);
}
