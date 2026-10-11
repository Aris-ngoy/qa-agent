import { getRunnerClient } from "@/app/runner-client";
import { type TestCase, mapCatalogCase } from "@/features/test-cases/data";
import type { CaseScript } from "@yoqa/runner-client";

/** Create a catalog case from an Inspector recording, then attach the replay script. */
export async function createInspectorCase(
	appId: string,
	name: string,
	script: CaseScript,
): Promise<TestCase> {
	const client = await getRunnerClient();
	const created = await client.createCase(appId, {
		name,
		flows: [
			{
				instructions: "Recorded in Manual Inspector",
				expectedResult: "",
			},
		],
	});
	return mapCatalogCase(await client.updateCase(created.id, { script }));
}
