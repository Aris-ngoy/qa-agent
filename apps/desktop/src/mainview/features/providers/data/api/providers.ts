import { getRunnerClient } from "@/app/runner-client";
import type {
	CreateProviderRequest,
	ProviderKind,
	UpdateProviderRequest,
} from "@yoqa/runner-client";

export async function listProviders() {
	return (await getRunnerClient()).listProviders();
}

export async function listProviderCatalog() {
	return (await getRunnerClient()).listProviderCatalog();
}

export async function listProviderModels(id: string) {
	return (await getRunnerClient()).listProviderModels(id);
}

/** Re-check every enabled provider; one that fails does not stop the others. */
export async function validateEnabledProviders() {
	const client = await getRunnerClient();
	const providers = await client.listProviders();
	for (const provider of providers) {
		if (!provider.enabled) continue;
		try {
			await client.validateProvider(provider.id);
		} catch {
			// Continue checking others.
		}
	}
	return providers;
}

export async function updateProvider(id: string, request: UpdateProviderRequest) {
	return (await getRunnerClient()).updateProvider(id, { ...request, validate: true });
}

export async function deleteProvider(id: string): Promise<void> {
	await (await getRunnerClient()).deleteProvider(id);
}

export async function setDefaultProvider(id: string): Promise<void> {
	await (await getRunnerClient()).setDefaultProvider(id);
}

export async function probeProvider(input: { kind: ProviderKind; binaryPath?: string | null }) {
	return (await getRunnerClient()).probeProvider(input);
}

/** Create a provider and validate it; the instance is kept even when validation fails. */
export async function createProvider(request: CreateProviderRequest) {
	const client = await getRunnerClient();
	const created = await client.createProvider(request);
	try {
		await client.validateProvider(created.id);
	} catch {
		// Keep instance even if validation fails.
	}
	return created;
}
