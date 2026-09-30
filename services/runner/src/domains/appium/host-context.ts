import { AsyncLocalStorage } from "node:async_hooks";
import { type RuntimeHost, bunHost } from "./host";

const storage = new AsyncLocalStorage<RuntimeHost>();

/** Host for the current Runtime call. Production uses the real process host. */
export function currentHost(): RuntimeHost {
	return storage.getStore() ?? bunHost;
}

export function usingHost<T>(host: RuntimeHost, run: () => Promise<T>): Promise<T> {
	return storage.run(host, run);
}
