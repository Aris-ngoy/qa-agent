import { CaseConfigurationPanel } from "@/features/test-cases/components/case-configuration-panel";
import { DuplicateIcon, TrashIcon } from "@/features/test-cases/components/case-icons";
import { CaseInstructionsPanel } from "@/features/test-cases/components/case-instructions-panel";
import { CaseScriptPanel } from "@/features/test-cases/components/case-script-panel";
import { useTestCaseSelection } from "@/features/test-cases/hooks/use-test-case-selection";
import {
	useCaseQuery,
	useCreateCase,
	useDeleteCase,
	useUpdateCase,
} from "@/features/test-cases/hooks/usequery/use-cases";
import {
	type FormValues,
	emptyDefaults,
	formFromCase,
} from "@/features/test-cases/utils/case-form";
import { Button, Form } from "@heroui/react";
import { useObservable, useValue } from "@legendapp/state/react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import type { CaseScript } from "@yoqa/runner-client";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";

type DetailTab = "instructions" | "configuration" | "script";

const TABS: { id: DetailTab; label: string }[] = [
	{ id: "instructions", label: "Instructions" },
	{ id: "configuration", label: "Configuration" },
	{ id: "script", label: "Script" },
];

export function TestCaseDetailPage() {
	const { caseId } = useParams({ strict: false }) as { caseId?: string };
	const navigate = useNavigate();
	const { setSelected } = useTestCaseSelection();
	const activeTab$ = useObservable<DetailTab>("instructions");
	const ready$ = useObservable(false);
	const activeTab = useValue(activeTab$);
	const ready = useValue(ready$);

	const {
		control,
		handleSubmit,
		reset,
		getValues,
		setValue,
		formState: { isDirty },
	} = useForm<FormValues>({
		defaultValues: emptyDefaults,
		mode: "onChange",
	});

	const nameValue = useWatch({ control, name: "name" });

	useEffect(() => {
		if (caseId) {
			setSelected([caseId]);
		}
	}, [caseId, setSelected]);

	const caseQuery = useCaseQuery(caseId);
	const testCase = caseQuery.data;

	const updateMutation = useUpdateCase();
	const deleteMutation = useDeleteCase();
	const duplicateMutation = useCreateCase();
	const scriptMutation = useUpdateCase();

	const saveCase = (next: FormValues) => {
		if (!caseId) return;
		updateMutation.mutate(
			{
				caseId,
				body: {
					name: next.name.trim(),
					tags: next.tags,
					flows: next.flows.map((flow) => ({
						id: flow.id.startsWith("cf_") ? flow.id : undefined,
						instructions: flow.instructions,
						expectedResult: flow.expectedResult,
						flowId: flow.flowId ?? null,
					})),
					recordVideo: next.recordVideo,
				},
			},
			{ onSuccess: (updated) => reset(formFromCase(updated)) },
		);
	};

	const deleteCase = () => {
		if (!caseId || !testCase) return;
		deleteMutation.mutate(
			{ caseId, appId: testCase.appId },
			{ onSuccess: () => void navigate({ to: "/test-cases" }) },
		);
	};

	const duplicateCase = () => {
		if (!testCase) return;
		const form = getValues();
		duplicateMutation.mutate(
			{
				appId: testCase.appId,
				body: {
					name: `${form.name.trim() || testCase.name} (copy)`,
					tags: form.tags,
					flows: form.flows.map((flow) => ({
						instructions: flow.instructions,
						expectedResult: flow.expectedResult,
					})),
					recordVideo: form.recordVideo,
				},
			},
			{
				onSuccess: (created) =>
					void navigate({ to: "/test-cases/$caseId", params: { caseId: created.id } }),
			},
		);
	};

	const saveScript = async (script: CaseScript | null) => {
		if (!caseId) throw new Error("Missing case id");
		await scriptMutation.mutateAsync({ caseId, body: { script } });
	};

	useEffect(() => {
		if (!testCase) {
			ready$.set(false);
			return;
		}
		reset(formFromCase(testCase));
		ready$.set(true);
	}, [testCase, reset, ready$]);

	// Only reset the tab when navigating to a different case — not when the
	// same case refreshes after script reorder / save.
	useEffect(() => {
		if (!caseId) return;
		activeTab$.set("instructions");
	}, [caseId, activeTab$]);

	if (caseQuery.isLoading) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-16">
				<p className="text-body-md text-on-surface-variant">Loading test case…</p>
			</div>
		);
	}

	if (!testCase || caseQuery.isError) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-16">
				<h1 className="text-headline-lg text-on-surface">Test case not found</h1>
				<p className="text-body-md text-on-surface-variant">
					No case matches{" "}
					<code className="rounded bg-surface-container px-1.5 py-0.5 text-body-sm">
						{caseId ?? "unknown"}
					</code>
					.
				</p>
				<Link
					className="w-fit text-body-md font-semibold text-on-surface underline-offset-2 hover:underline"
					to="/test-cases"
				>
					Back to Test Cases
				</Link>
			</div>
		);
	}

	if (!ready) {
		return null;
	}

	const canSave = isDirty && (nameValue?.trim().length ?? 0) > 0 && !updateMutation.isPending;
	const breadcrumbTitle = `#${testCase.number} ${nameValue?.trim() || testCase.name}`;

	const onSubmit = (values: FormValues) => {
		saveCase({ ...values, name: values.name.trim() });
	};

	return (
		<div className="flex h-full min-h-0 w-full flex-col gap-6">
			<header className="motion-fade-up flex shrink-0 flex-wrap items-center justify-between gap-4">
				<nav className="flex min-w-0 items-center gap-2 text-body-md text-on-surface-variant">
					<Link
						className="shrink-0 transition-colors duration-[var(--motion-fast)] hover:text-on-surface"
						to="/test-cases"
					>
						Test Cases
					</Link>
					<span aria-hidden="true">&gt;</span>
					<span className="truncate font-medium text-on-surface">{breadcrumbTitle}</span>
				</nav>

				<div className="flex items-center gap-1">
					<Button
						aria-label="Delete test case"
						className="size-10 min-w-10 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-error-container/40 data-[hovered=true]:text-error"
						isDisabled={deleteMutation.isPending}
						onPress={deleteCase}
						variant="ghost"
					>
						<TrashIcon />
					</Button>
					<Button
						aria-label="Duplicate test case"
						className="size-10 min-w-10 rounded-lg bg-transparent text-on-surface-variant data-[hovered=true]:bg-surface-container"
						isDisabled={duplicateMutation.isPending}
						onPress={duplicateCase}
						variant="ghost"
					>
						<DuplicateIcon />
					</Button>
					<Button
						className="ml-1 rounded-lg bg-primary px-5 text-on-primary data-[hovered=true]:bg-primary/90 data-[disabled=true]:bg-surface-container-highest data-[disabled=true]:text-on-surface-variant"
						form="test-case-form"
						isDisabled={!canSave}
						type="submit"
					>
						{updateMutation.isPending ? "Saving…" : "Save"}
					</Button>
				</div>
			</header>

			<div
				className="flex shrink-0 items-center gap-8 border-b border-outline-variant"
				role="tablist"
			>
				{TABS.map((tab) => {
					const isActive = tab.id === activeTab;
					return (
						<button
							aria-selected={isActive}
							className={
								isActive
									? "border-b-2 border-primary pb-3 text-body-md font-semibold text-on-surface"
									: "pb-3 text-body-md text-on-surface-variant transition-colors hover:text-on-surface"
							}
							key={tab.id}
							onClick={() => activeTab$.set(tab.id)}
							role="tab"
							type="button"
						>
							{tab.label}
						</button>
					);
				})}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto pb-4" role="tabpanel">
				<Form className="contents" id="test-case-form" onSubmit={handleSubmit(onSubmit)}>
					{activeTab === "instructions" ? (
						<CaseInstructionsPanel control={control} setValue={setValue} />
					) : null}
					{activeTab === "configuration" ? (
						<CaseConfigurationPanel control={control} setValue={setValue} />
					) : null}
				</Form>
				{activeTab === "script" ? (
					<CaseScriptPanel
						busy={scriptMutation.isPending}
						caseName={testCase.name}
						caseNumber={testCase.number}
						onDeleteScript={() => saveScript(null)}
						onSaveScript={(next) => saveScript(next)}
						script={testCase.script}
						scriptSavedAt={testCase.scriptSavedAt}
					/>
				) : null}
			</div>
		</div>
	);
}
