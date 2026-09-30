import { APPIUM_HOST } from "./host";
import type { ForeignAppiumInfo, ManagedAppiumInfo } from "./models";
import { productionRuntime } from "./runtime";

export { APPIUM_HOST };
export type { ForeignAppiumInfo, ManagedAppiumInfo };

/** Register a callback when the managed Appium process exits or is stopped. */
export function setOnAppiumStopped(handler: (() => void) | null): void {
	productionRuntime.setOnStopped(handler);
}

/** Ensure the Appium Server process is running; returns its listen port. */
export async function ensureAppiumServer(): Promise<number> {
	return productionRuntime.ensureServer();
}

export function getManagedAppiumInfo(): ManagedAppiumInfo | null {
	return productionRuntime.managedInfo();
}

export async function listForeignAppium(): Promise<ForeignAppiumInfo[]> {
	return productionRuntime.listForeign();
}

export async function listAppiumServers(): Promise<Array<ManagedAppiumInfo | ForeignAppiumInfo>> {
	const managed = productionRuntime.managedInfo();
	const foreign = await productionRuntime.listForeign();
	return managed ? [managed, ...foreign] : foreign;
}

export async function stopAppiumServer(): Promise<boolean> {
	return productionRuntime.stopServer();
}

export async function stopForeignAppium(id: string): Promise<boolean> {
	return productionRuntime.stopForeign(id);
}

export async function stopAllForeignAppium(): Promise<number> {
	return productionRuntime.stopAllForeign();
}

export async function stopAppiumById(id: string): Promise<boolean> {
	const managed = productionRuntime.managedInfo();
	if (managed?.id === id) {
		return productionRuntime.stopServer();
	}
	return productionRuntime.stopForeign(id);
}

/** Stop managed Appium (if any) then start a fresh managed instance. */
export async function restartAppiumServer(): Promise<number> {
	await productionRuntime.stopServer();
	return productionRuntime.ensureServer();
}

/**
 * Restart semantics for a foreign entry: kill it, then ensure Yoqa-managed Appium.
 */
export async function restartAppiumById(id: string): Promise<number> {
	const managed = productionRuntime.managedInfo();
	if (managed?.id === id) {
		return restartAppiumServer();
	}
	const stopped = await productionRuntime.stopForeign(id);
	if (!stopped) {
		throw new Error(`Unknown Appium server: ${id}`);
	}
	return productionRuntime.ensureServer();
}
