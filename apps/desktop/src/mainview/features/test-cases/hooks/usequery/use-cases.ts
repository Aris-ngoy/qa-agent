import {
	createCase,
	deleteCase,
	getCase,
	listCases,
	updateCase,
} from "@/features/test-cases/data/api/cases";
import type { TestCase } from "@/features/test-cases/utils/catalog-case";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCaseRequest, UpdateCaseRequest } from "@yoqa/runner-client";

export function casesQueryKey(appId: string) {
	return ["catalog", "cases", appId] as const;
}

export function caseQueryKey(caseId: string) {
	return ["catalog", "case", caseId] as const;
}

/** The app's test cases, shared by the list, the run views, and the Run button. */
export function useCasesQuery(appId: string | null | undefined) {
	return useQuery({
		queryKey: appId ? casesQueryKey(appId) : ["catalog", "cases", "none"],
		enabled: Boolean(appId),
		queryFn: () => (appId ? listCases(appId) : Promise.resolve([] as TestCase[])),
	});
}

function caseQueryOptions(caseId: string | null | undefined) {
	return queryOptions({
		queryKey: caseId ? caseQueryKey(caseId) : ["catalog", "case", "none"],
		queryFn: () => {
			if (!caseId) throw new Error("Missing case id");
			return getCase(caseId);
		},
		retry: false,
	});
}

export function useCaseQuery(caseId: string | null | undefined) {
	return useQuery({ ...caseQueryOptions(caseId), enabled: Boolean(caseId) });
}

/** The cached case, kept current but never fetched here: the detail page loads it. */
export function useCachedCase(caseId: string | null | undefined) {
	return useQuery({ ...caseQueryOptions(caseId), enabled: false }).data;
}

/** Create a case in `appId` and put it first in the app's list. */
export function useCreateCase() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ appId, body }: { appId: string; body: CreateCaseRequest }) =>
			createCase(appId, body),
		onSuccess: (created) => {
			queryClient.setQueryData<TestCase[]>(casesQueryKey(created.appId), (current) =>
				current ? [created, ...current] : [created],
			);
		},
	});
}

/** Update a case, write it into the cache, and refresh its app's list. */
export function useUpdateCase() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({ caseId, body }: { caseId: string; body: UpdateCaseRequest }) =>
			updateCase(caseId, body),
		onSuccess: (updated) => {
			queryClient.setQueryData(caseQueryKey(updated.id), updated);
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(updated.appId) });
		},
	});
}

export function useDeleteCase() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: async ({ caseId, appId }: { caseId: string; appId: string }) => {
			await deleteCase(caseId);
			return appId;
		},
		onSuccess: (appId) => {
			void queryClient.invalidateQueries({ queryKey: casesQueryKey(appId) });
		},
	});
}
