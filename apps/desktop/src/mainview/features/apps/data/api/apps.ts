import { getRunnerClient } from "@/app/runner-client";
import type { CatalogApp, UpdateAppRequest } from "@yoqa/runner-client";

export type Application = {
	id: string;
	name: string;
	context: string;
	knowledge: string;
	iosBundleId: string;
	iosAppStoreId: string;
	androidApplicationId: string;
	webUrl: string;
};

export type ApplicationUpdates = Partial<
	Pick<
		Application,
		| "name"
		| "context"
		| "knowledge"
		| "iosBundleId"
		| "iosAppStoreId"
		| "androidApplicationId"
		| "webUrl"
	>
>;

function mapCatalogApp(app: CatalogApp): Application {
	return {
		id: app.id,
		name: app.name,
		context: app.context,
		knowledge: app.knowledge,
		iosBundleId: app.iosBundleId,
		iosAppStoreId: app.iosAppStoreId,
		androidApplicationId: app.androidApplicationId,
		webUrl: app.webUrl,
	};
}

export async function listApps(): Promise<Application[]> {
	const client = await getRunnerClient();
	const apps = await client.listApps();
	return apps.map(mapCatalogApp);
}

export async function createApp(name: string): Promise<Application> {
	const client = await getRunnerClient();
	return mapCatalogApp(await client.createApp({ name }));
}

export async function updateApp(id: string, updates: ApplicationUpdates): Promise<Application> {
	const client = await getRunnerClient();
	const body: UpdateAppRequest = { ...updates };
	return mapCatalogApp(await client.updateApp(id, body));
}

export async function deleteApp(id: string): Promise<string> {
	const client = await getRunnerClient();
	await client.deleteApp(id);
	return id;
}
