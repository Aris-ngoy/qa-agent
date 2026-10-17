import { getRunnerClient } from "@/app/runner-client";
import { type TestCase, mapCatalogCase } from "@/features/test-cases/utils/catalog-case";
import type { CreateCaseRequest, UpdateCaseRequest } from "@yoqa/runner-client";

export async function listCases(appId: string): Promise<TestCase[]> {
	const client = await getRunnerClient();
	const cases = await client.listCases(appId);
	return cases.map((row) => mapCatalogCase(row));
}

export async function getCase(caseId: string): Promise<TestCase> {
	const client = await getRunnerClient();
	return mapCatalogCase(await client.getCase(caseId));
}

export async function createCase(appId: string, body: CreateCaseRequest): Promise<TestCase> {
	const client = await getRunnerClient();
	return mapCatalogCase(await client.createCase(appId, body));
}

export async function updateCase(caseId: string, body: UpdateCaseRequest): Promise<TestCase> {
	const client = await getRunnerClient();
	return mapCatalogCase(await client.updateCase(caseId, body));
}

export async function deleteCase(caseId: string): Promise<void> {
	const client = await getRunnerClient();
	await client.deleteCase(caseId);
}
