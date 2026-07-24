import { getRunnerClient } from "@/app/runner-client";
import { useApps } from "@/features/apps/context";
import {
	type CaseStatus,
	type TestCase,
	casesQueryKey,
	mapCatalogCase,
} from "@/features/test-cases/data";
import { useTestCaseSelection } from "@/features/test-cases/selection-context";
import { Button } from "@heroui/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

function CaseStatusPill({ status }: { status: CaseStatus | null }) {
	if (status === "passed") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/70 px-3 py-1 text-helper font-semibold text-on-secondary-container">
				<span className="size-1.5 rounded-full bg-secondary" />
				Passed
			</span>
		);
	}

	if (status === "errored") {
		return (
			<span className="inline-flex items-center gap-1.5 rounded-full bg-error-container/70 px-3 py-1 text-helper font-semibold text-on-error-container">
				<span className="size-1.5 rounded-full bg-error" />
				Errored
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-helper font-semibold text-on-surface-variant">
			<span className="size-1.5 rounded-full bg-on-surface-variant/50" />
			Not run
		</span>
	);
}

export function TestCasesPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { selectedApp } = useApps();
	const { selectedCaseIds, toggle, setSelected, isSelected } = useTestCaseSelection();
	const [filter, setFilter] = useState("");

	const casesQuery = useQuery({
		queryKey: selectedApp ? casesQueryKey(selectedApp.id) : ["catalog", "cases", "none"],
		enabled: Boolean(selectedApp),
		queryFn: async () => {
			if (!selectedApp) return [] as TestCase[];
			const client = await getRunnerClient();
			const cases = await client.listCases(selectedApp.id);
			return cases.map((row) => mapCatalogCase(row));
		},
	});

	const createMutation = useMutation({
		mutationFn: async () => {
			if (!selectedApp) {
				throw new Error("Select an app first");
			}
			const client = await getRunnerClient();
			return mapCatalogCase(
				await client.createCase(selectedApp.id, {
					name: "New test case",
					flows: [{ instructions: "", expectedResult: "" }],
				}),
			);
		},
		onSuccess: (created) => {
			if (selectedApp) {
				queryClient.setQueryData<TestCase[]>(casesQueryKey(selectedApp.id), (current) =>
					current ? [created, ...current] : [created],
				);
			}
			void navigate({ to: "/test-cases/$caseId", params: { caseId: created.id } });
		},
	});

	const rows = useMemo(() => {
		const all = casesQuery.data ?? [];
		const query = filter.trim().toLowerCase();
		if (!query) return all;
		return all.filter((row) => {
			const haystack = `${row.name} ${row.tags.join(" ")} ${row.status ?? ""}`.toLowerCase();
			return haystack.includes(query);
		});
	}, [casesQuery.data, filter]);

	const allFilteredSelected =
		rows.length > 0 && rows.every((row) => selectedCaseIds.includes(row.id));
	const someFilteredSelected = rows.some((row) => selectedCaseIds.includes(row.id));

	const openCase = (caseId: string) => {
		void navigate({ to: "/test-cases/$caseId", params: { caseId } });
	};

	const toggleAllFiltered = () => {
		if (allFilteredSelected) {
			const filteredIds = new Set(rows.map((row) => row.id));
			setSelected(selectedCaseIds.filter((id) => !filteredIds.has(id)));
		} else {
			setSelected([...new Set([...selectedCaseIds, ...rows.map((row) => row.id)])]);
		}
	};

	if (!selectedApp) {
		return (
			<div className="flex w-full flex-col gap-4 py-16">
				<h1 className="text-headline-lg text-on-surface">Test Cases</h1>
				<p className="text-body-md text-on-surface-variant">
					Select or create an app to manage its test cases.
				</p>
			</div>
		);
	}

	return (
		<div className="flex w-full flex-col gap-8 pb-4">
			<div className="flex flex-wrap items-center gap-6">
				<div className="min-w-[10rem]">
					<h1 className="text-headline-lg text-on-surface">Test Cases</h1>
					<p className="text-body-sm text-on-surface-variant">
						Automated regression suites for {selectedApp.name}
						{selectedCaseIds.length > 0 ? ` · ${selectedCaseIds.length} selected` : null}
					</p>
				</div>
				<label className="relative min-w-[16rem] max-w-xl flex-1">
					<span className="sr-only">Filter test cases</span>
					<span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-5 text-on-surface-variant">
						<svg
							aria-hidden="true"
							className="size-4"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.75"
							viewBox="0 0 24 24"
						>
							<path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" strokeLinecap="round" />
						</svg>
					</span>
					<input
						className="w-full rounded-full border-none bg-surface-container-lowest py-3.5 pl-12 pr-5 text-body-md text-on-surface shadow-card placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
						onChange={(event) => setFilter(event.target.value)}
						placeholder="Filter by name, tag, or status…"
						type="search"
						value={filter}
					/>
				</label>
				<Button
					className="rounded-full bg-primary px-5 text-on-primary data-[hovered=true]:bg-primary/90"
					isDisabled={createMutation.isPending}
					onPress={() => createMutation.mutate()}
				>
					New test case
				</Button>
			</div>

			<div className="overflow-hidden rounded-2xl bg-surface-container-lowest shadow-soft">
				<table className="w-full border-collapse text-left">
					<thead>
						<tr className="border-b border-outline-variant/70">
							<th className="w-12 px-4 py-4">
								<input
									aria-label="Select all filtered test cases"
									checked={allFilteredSelected}
									className="size-4 accent-primary"
									disabled={rows.length === 0}
									onChange={toggleAllFiltered}
									ref={(el) => {
										if (el) {
											el.indeterminate = someFilteredSelected && !allFilteredSelected;
										}
									}}
									type="checkbox"
								/>
							</th>
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Name
							</th>
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Created
							</th>
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Last Run
							</th>
							<th className="px-6 py-4 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Status
							</th>
							<th className="px-6 py-4">
								<span className="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-outline-variant/50 text-body-md">
						{casesQuery.isLoading ? (
							<tr>
								<td className="px-6 py-8 text-body-md text-on-surface-variant" colSpan={6}>
									Loading test cases…
								</td>
							</tr>
						) : rows.length === 0 ? (
							<tr>
								<td className="px-6 py-8 text-body-md text-on-surface-variant" colSpan={6}>
									{filter.trim()
										? `No test cases match “${filter.trim()}”.`
										: "No test cases yet. Create one to get started."}
								</td>
							</tr>
						) : (
							rows.map((row) => (
								<tr
									className={`cursor-pointer transition-colors hover:bg-surface-container-low ${
										isSelected(row.id) ? "bg-primary/5" : ""
									}`}
									key={row.id}
									onClick={() => openCase(row.id)}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.preventDefault();
											openCase(row.id);
										}
									}}
									tabIndex={0}
								>
									<td
										className="px-4 py-4"
										onClick={(event) => event.stopPropagation()}
										onKeyDown={(event) => event.stopPropagation()}
									>
										<input
											aria-label={`Select ${row.name}`}
											checked={isSelected(row.id)}
											className="size-4 accent-primary"
											onChange={() => toggle(row.id)}
											type="checkbox"
										/>
									</td>
									<td className="px-6 py-4">
										<div className="flex items-center gap-3">
											<span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-card-lavender text-body-sm font-semibold text-primary">
												{row.name.slice(0, 1)}
											</span>
											<div>
												<div className="font-semibold text-on-surface">{row.name}</div>
												<div className="text-helper text-on-surface-variant">
													{row.tags.length > 0 ? row.tags.join(", ") : `Case #${row.number}`}
												</div>
											</div>
										</div>
									</td>
									<td className="px-6 py-4 text-on-surface-variant">{row.created}</td>
									<td className="px-6 py-4 text-on-surface-variant">{row.lastRun}</td>
									<td className="px-6 py-4">
										<CaseStatusPill status={row.status} />
									</td>
									<td className="px-6 py-4 text-right">
										<span className="inline-flex rounded-full p-1.5 text-on-surface-variant">
											<svg
												aria-hidden="true"
												className="size-5"
												fill="currentColor"
												viewBox="0 0 24 24"
											>
												<circle cx="12" cy="5" r="1.5" />
												<circle cx="12" cy="12" r="1.5" />
												<circle cx="12" cy="19" r="1.5" />
											</svg>
										</span>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>

				<div className="flex items-center justify-between border-t border-outline-variant/70 px-6 py-4">
					<span className="text-body-sm text-on-surface-variant">
						Showing {rows.length === 0 ? "0" : `1-${rows.length}`} of {casesQuery.data?.length ?? 0}{" "}
						test cases
					</span>
				</div>
			</div>
		</div>
	);
}
