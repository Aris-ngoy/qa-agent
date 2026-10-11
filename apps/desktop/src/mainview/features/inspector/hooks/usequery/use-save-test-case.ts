import { createInspectorCase } from "@/features/inspector/data/api/cases";
import { type TestCase, caseQueryKey, casesQueryKey } from "@/features/test-cases/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CaseScript } from "@yoqa/runner-client";

type SaveTestCaseInput = {
	appId: string;
	name: string;
	script: CaseScript;
};

/** Create the catalog case and write it into the case list cache. */
export function useSaveTestCase() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: (input: SaveTestCaseInput) =>
			createInspectorCase(input.appId, input.name, input.script),
		onSuccess: (mapped, input) => {
			queryClient.setQueryData(caseQueryKey(mapped.id), mapped);
			queryClient.setQueryData<TestCase[]>(casesQueryKey(input.appId), (current) =>
				current ? [mapped, ...current.filter((row) => row.id !== mapped.id)] : [mapped],
			);
		},
	});
}
