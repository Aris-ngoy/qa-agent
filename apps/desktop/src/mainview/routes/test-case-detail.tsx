import { Link, useParams } from "@tanstack/react-router";
import { type SVGProps, useState } from "react";
import { type CaseStatus, getTestCase } from "../test-cases-data";

type DetailTab = "configuration" | "variables" | "recent-runs";

const TABS: { id: DetailTab; label: string }[] = [
	{ id: "configuration", label: "Configuration" },
	{ id: "recent-runs", label: "Recent Runs" },
	{ id: "variables", label: "Variables" },
];

type VariableRow = {
	key: string;
	value: string;
	type: "text" | "secret";
};

const MOCK_VARIABLES: VariableRow[] = [
	{ key: "BASE_URL", value: "https://api.staging.noqa.dev", type: "text" },
	{ key: "AUTH_TOKEN", value: "••••••••••••••••", type: "secret" },
	{ key: "RETRY_LIMIT", value: "3", type: "text" },
	{ key: "DB_PASSWORD", value: "••••••••••••••••", type: "secret" },
];

type RunStatus = "running" | "passed" | "errored";

type RunRow = {
	id: string;
	when: string;
	environment: string;
	duration: string;
	status: RunStatus;
};

const MOCK_RUNS: RunRow[] = [
	{
		id: "#RUN-8921",
		when: "Oct 24, 2023 · 14:22:01",
		environment: "STAGING",
		duration: "--",
		status: "running",
	},
	{
		id: "#RUN-8920",
		when: "Oct 24, 2023 · 12:05:44",
		environment: "PRODUCTION",
		duration: "1.2s",
		status: "passed",
	},
	{
		id: "#RUN-8919",
		when: "Oct 23, 2023 · 18:41:12",
		environment: "STAGING",
		duration: "4.8s",
		status: "errored",
	},
	{
		id: "#RUN-8918",
		when: "Oct 23, 2023 · 11:15:30",
		environment: "STAGING",
		duration: "1.4s",
		status: "passed",
	},
	{
		id: "#RUN-8917",
		when: "Oct 22, 2023 · 09:12:05",
		environment: "PRODUCTION",
		duration: "1.1s",
		status: "passed",
	},
];

function Icon(props: SVGProps<SVGSVGElement>) {
	return (
		<svg
			aria-hidden="true"
			className="size-[18px]"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			viewBox="0 0 24 24"
			{...props}
		/>
	);
}

function StatusMeta({ status, lastRun }: { status: CaseStatus; lastRun: string }) {
	if (status === "passed") {
		return (
			<span className="inline-flex items-center gap-1.5 font-medium text-secondary">
				<svg aria-hidden="true" className="size-[18px]" fill="currentColor" viewBox="0 0 24 24">
					<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.2l-3.5-3.5 1.4-1.4 2.1 2.1 4.5-4.5 1.4 1.4-5.9 5.9z" />
				</svg>
				<span className="text-body-sm">Last Run Passed ({lastRun})</span>
			</span>
		);
	}

	return (
		<span className="inline-flex items-center gap-1.5 font-medium text-error">
			<svg aria-hidden="true" className="size-[18px]" fill="currentColor" viewBox="0 0 24 24">
				<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z" />
			</svg>
			<span className="text-body-sm">Last Run Errored ({lastRun})</span>
		</span>
	);
}

function TagPill({ label }: { label: string }) {
	const isPriority = /^P\d+$/i.test(label);
	return (
		<span
			className={
				isPriority
					? "rounded-full bg-error-container px-2 py-0.5 text-helper font-bold uppercase tracking-wider text-on-error-container"
					: "rounded-full bg-surface-container-highest px-2 py-0.5 text-helper font-bold uppercase tracking-wider text-on-surface-variant"
			}
		>
			{label}
		</span>
	);
}

function ConfigurationPanel() {
	return (
		<div className="grid grid-cols-12 gap-gutter">
			<section className="col-span-12 rounded-lg border border-outline-variant bg-surface-container-lowest p-6 lg:col-span-7">
				<div className="mb-4 flex items-start justify-between gap-4">
					<div>
						<h2 className="mb-2 text-headline-md text-on-surface">Appium Capabilities</h2>
						<p className="max-w-md text-body-md text-on-surface-variant">
							Custom capabilities passed to the driver. Overrides app-level capabilities for
							specific testing environments.
						</p>
					</div>
					<span className="text-on-surface-variant opacity-20">
						<Icon>
							<circle cx="12" cy="12" r="3" />
							<path
								d="M12 3v2M12 19v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M3 12h2M19 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"
								strokeLinecap="round"
							/>
						</Icon>
					</span>
				</div>
				<button
					className="inline-flex items-center gap-2 rounded bg-surface-container-low px-4 py-2 text-body-md font-medium text-on-surface transition-colors hover:bg-surface-container-high"
					type="button"
				>
					<svg aria-hidden="true" className="size-[18px]" fill="currentColor" viewBox="0 0 20 20">
						<path d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" />
					</svg>
					Add capability
				</button>
			</section>

			<section className="col-span-12 flex flex-col justify-between rounded-lg border border-secondary/20 bg-secondary-container/10 p-6 lg:col-span-5">
				<div>
					<h3 className="mb-4 text-label-caps uppercase text-secondary">Environment Check</h3>
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<span className="text-body-sm text-on-surface-variant">Default OS</span>
							<span className="text-body-sm font-semibold">Android 14.0</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-body-sm text-on-surface-variant">Device Pool</span>
							<span className="text-body-sm font-semibold">Global-S-Tier</span>
						</div>
					</div>
				</div>
				<div className="mt-8 flex items-center gap-3 rounded border border-white/20 bg-white/50 p-3">
					<svg
						aria-hidden="true"
						className="size-5 shrink-0 text-secondary"
						fill="currentColor"
						viewBox="0 0 24 24"
					>
						<path d="M11 21h-1l1-7H7.5c-.6 0-.9-.7-.5-1.1L16 3h1l-1 7h3.5c.6 0 .9.7.5 1.1L11 21z" />
					</svg>
					<p className="text-helper text-on-surface-variant">
						Optimized for high-concurrency execution with current settings.
					</p>
				</div>
			</section>

			<section className="col-span-12 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
				<div className="flex items-center justify-between border-b border-outline-variant p-6">
					<div>
						<h2 className="text-headline-md text-on-surface">Cloud Configuration</h2>
						<p className="text-body-md text-on-surface-variant">
							Manage external assets and regional overrides.
						</p>
					</div>
				</div>
				<div className="grid grid-cols-1 gap-10 p-6 md:grid-cols-2">
					<div className="space-y-4">
						<h3 className="text-subheading text-on-surface">Gallery images</h3>
						<p className="text-body-sm text-on-surface-variant">
							Images added here will be pre-loaded into the device gallery before the test runs.
						</p>
						<div className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-outline-variant bg-surface-container-lowest p-8 transition-colors hover:bg-surface-container-low">
							<div className="flex size-12 items-center justify-center rounded-full bg-surface-container-high">
								<Icon>
									<path
										d="M12 16V8M8 12l4-4 4 4M4 20h16"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
								</Icon>
							</div>
							<span className="text-body-md font-medium text-on-surface">Upload image</span>
							<span className="text-center text-helper text-on-surface-variant">
								JPG, PNG up to 5MB
							</span>
						</div>
					</div>
					<div className="space-y-4">
						<h3 className="text-subheading text-on-surface">Locale</h3>
						<p className="text-body-sm text-on-surface-variant">
							Override the device system language and region for this specific test case.
						</p>
						<label className="block">
							<span className="sr-only">Locale</span>
							<select
								className="h-11 w-full appearance-none rounded border border-outline-variant bg-surface-container-lowest px-4 text-body-md text-on-surface focus:border-primary focus:outline-none"
								defaultValue=""
							>
								<option disabled value="">
									Select locale...
								</option>
								<option value="en-US">English (United States)</option>
								<option value="en-GB">English (United Kingdom)</option>
								<option value="fr-FR">French (France)</option>
								<option value="de-DE">German (Germany)</option>
								<option value="es-ES">Spanish (Spain)</option>
								<option value="ja-JP">Japanese (Japan)</option>
							</select>
						</label>
						<div className="flex items-center gap-4 rounded border border-outline-variant/50 bg-surface-container-low p-4">
							<div>
								<p className="text-body-sm font-semibold">System Default</p>
								<p className="text-helper text-on-surface-variant">
									Currently using project-wide settings (en-US)
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}

function VariablesPanel() {
	return (
		<div className="grid grid-cols-12 gap-gutter">
			<div className="col-span-12 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest lg:col-span-9">
				<div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-4">
					<h3 className="text-subheading">Active Variables</h3>
					<span className="rounded bg-surface-container-highest px-2 py-0.5 text-helper font-bold uppercase tracking-wider text-on-surface-variant">
						{MOCK_VARIABLES.length} Total
					</span>
				</div>
				<table className="w-full border-collapse text-left">
					<thead>
						<tr className="bg-surface-container-low/50">
							<th className="border-b border-outline-variant px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Key
							</th>
							<th className="border-b border-outline-variant px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Value
							</th>
							<th className="border-b border-outline-variant px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Type
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-outline-variant">
						{MOCK_VARIABLES.map((variable) => (
							<tr
								className="transition-colors hover:bg-surface-container-low/30"
								key={variable.key}
							>
								<td className="px-6 py-4">
									<code className="rounded bg-surface-container px-2 py-1 font-mono text-body-sm font-semibold text-primary">
										{variable.key}
									</code>
								</td>
								<td className="px-6 py-4 font-mono text-body-sm text-on-surface-variant">
									{variable.value}
								</td>
								<td className="px-6 py-4">
									{variable.type === "secret" ? (
										<span className="inline-flex items-center rounded-full bg-error-container/40 px-2.5 py-0.5 text-helper font-semibold text-on-error-container">
											Secret
										</span>
									) : (
										<span className="inline-flex items-center rounded-full bg-secondary-container/30 px-2.5 py-0.5 text-helper font-semibold text-on-secondary-container">
											Text
										</span>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			<div className="col-span-12 space-y-gutter lg:col-span-3">
				<div className="rounded-lg border border-outline-variant bg-surface-container-low p-6">
					<h4 className="mb-4 text-subheading text-primary">Helpful Tip</h4>
					<p className="text-body-sm leading-relaxed text-on-surface-variant">
						Use{" "}
						<code className="rounded border border-outline-variant bg-surface-container-lowest px-1">
							{"{{VARIABLE_NAME}}"}
						</code>{" "}
						syntax within your test steps to inject these values at runtime.
					</p>
				</div>
				<div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-container">
					<div className="border-b border-outline-variant bg-surface-container-high/50 p-4">
						<h4 className="text-label-caps uppercase text-on-surface">Scoped Variables</h4>
					</div>
					<div className="space-y-4 p-4">
						<div className="flex items-center justify-between">
							<span className="text-body-sm text-on-surface-variant">Global</span>
							<span className="text-body-sm font-semibold">12</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-body-sm text-on-surface-variant">Project</span>
							<span className="text-body-sm font-semibold">8</span>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-body-sm text-on-surface-variant">Case Local</span>
							<span className="text-body-sm font-semibold text-primary">4</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function RunStatusCell({ status }: { status: RunStatus }) {
	if (status === "running") {
		return <span className="font-semibold italic text-primary">Running</span>;
	}
	if (status === "passed") {
		return <span className="font-semibold text-secondary">Passed</span>;
	}
	return <span className="font-semibold text-error">Errored</span>;
}

function RecentRunsPanel({ caseStatus }: { caseStatus: CaseStatus }) {
	const lastStatusLabel = caseStatus === "passed" ? "Passed" : "Errored";
	const lastStatusClass =
		caseStatus === "passed"
			? "text-subheading font-semibold text-secondary"
			: "text-subheading font-semibold text-error";

	const runs =
		caseStatus === "errored"
			? MOCK_RUNS.map((run, index) =>
					index === 1 ? { ...run, status: "errored" as const, duration: "3.6s" } : run,
				)
			: MOCK_RUNS;

	const metrics: {
		label: string;
		value: string;
		hint: string | null;
		hintTone: "success" | "muted";
		valueClass?: string;
	}[] = [
		{ label: "Success Rate", value: "98.4%", hint: "+2.1%", hintTone: "success" },
		{ label: "Avg. Duration", value: "1.4s", hint: "-120ms", hintTone: "muted" },
		{ label: "Total Runs", value: "1,248", hint: null, hintTone: "muted" },
		{
			label: "Last Status",
			value: lastStatusLabel,
			hint: null,
			hintTone: "success",
			valueClass: lastStatusClass,
		},
	];

	return (
		<div className="space-y-8">
			<section className="grid grid-cols-1 gap-gutter sm:grid-cols-2 xl:grid-cols-4">
				{metrics.map((metric) => (
					<div
						className="rounded-lg border border-outline-variant bg-surface p-5"
						key={metric.label}
					>
						<p className="mb-2 text-label-caps uppercase tracking-widest text-on-surface-variant">
							{metric.label}
						</p>
						<div className="flex items-baseline gap-2">
							<span className={metric.valueClass ?? "text-headline-lg text-on-surface"}>
								{metric.value}
							</span>
							{metric.hint ? (
								<span
									className={
										metric.hintTone === "success"
											? "text-body-sm font-semibold text-secondary"
											: "text-body-sm text-on-surface-variant"
									}
								>
									{metric.hint}
								</span>
							) : null}
						</div>
					</div>
				))}
			</section>

			<div className="overflow-hidden rounded-lg border border-outline-variant bg-surface shadow-sm">
				<div className="flex items-center justify-between border-b border-outline-variant bg-surface-container-low px-6 py-4">
					<h3 className="text-subheading text-primary">Recent Run Activity</h3>
					<span className="text-body-sm text-on-surface-variant">Showing 5 of 1,248 runs</span>
				</div>
				<table className="w-full border-collapse text-left">
					<thead>
						<tr className="border-b border-outline-variant">
							<th className="px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Run ID
							</th>
							<th className="px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Date/Time
							</th>
							<th className="px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Environment
							</th>
							<th className="px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Duration
							</th>
							<th className="px-6 py-3 text-label-caps uppercase tracking-widest text-on-surface-variant">
								Status
							</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-outline-variant">
						{runs.map((run) => (
							<tr className="transition-colors hover:bg-surface-container-low" key={run.id}>
								<td className="px-6 py-4 font-mono text-body-sm text-primary">{run.id}</td>
								<td className="px-6 py-4 text-on-surface-variant">{run.when}</td>
								<td className="px-6 py-4">
									<span className="rounded bg-surface-container-high px-2 py-0.5 text-helper font-bold">
										{run.environment}
									</span>
								</td>
								<td className="px-6 py-4 text-on-surface-variant">{run.duration}</td>
								<td className="px-6 py-4">
									<RunStatusCell status={run.status} />
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function TabContent({ tab, caseStatus }: { tab: DetailTab; caseStatus: CaseStatus }) {
	if (tab === "configuration") {
		return <ConfigurationPanel />;
	}
	if (tab === "variables") {
		return <VariablesPanel />;
	}
	return <RecentRunsPanel caseStatus={caseStatus} />;
}

export function TestCaseDetailPage() {
	const { caseId } = useParams({ strict: false }) as { caseId?: string };
	const testCase = caseId ? getTestCase(caseId) : undefined;
	const [activeTab, setActiveTab] = useState<DetailTab>("configuration");

	if (!testCase) {
		return (
			<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 py-16">
				<h1 className="text-headline-lg text-primary">Test case not found</h1>
				<p className="text-body-md text-on-surface-variant">
					No case matches{" "}
					<code className="rounded bg-surface-container px-1.5 py-0.5 text-body-sm">
						{caseId ?? "unknown"}
					</code>
					.
				</p>
				<Link
					className="w-fit text-body-md font-semibold text-primary underline-offset-2 hover:underline"
					to="/test-cases"
				>
					Back to Test Cases
				</Link>
			</div>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
			<nav className="flex items-center gap-2 text-body-sm text-on-surface-variant">
				<Link className="transition-colors hover:text-primary" to="/test-cases">
					Test Cases
				</Link>
				<span aria-hidden="true">/</span>
				<span className="font-semibold text-primary">{testCase.name}</span>
			</nav>

			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="space-y-3">
					<div className="flex flex-wrap items-center gap-3">
						<h1 className="text-headline-lg text-primary">{testCase.name}</h1>
						<div className="flex flex-wrap gap-2">
							{testCase.tags.map((tag) => (
								<TagPill key={tag} label={tag} />
							))}
						</div>
					</div>
					<div className="flex flex-wrap items-center gap-4 text-body-sm">
						<StatusMeta lastRun={testCase.lastRun} status={testCase.status} />
						<span className="hidden size-1 rounded-full bg-outline-variant sm:inline-block" />
						<span className="text-on-surface-variant">suite: {testCase.suite}</span>
						<span className="hidden size-1 rounded-full bg-outline-variant sm:inline-block" />
						<span className="text-on-surface-variant">Creator: {testCase.creator}</span>
						<span className="hidden size-1 rounded-full bg-outline-variant sm:inline-block" />
						<span className="text-on-surface-variant">Last Edit: {testCase.lastEdit}</span>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<button
						className="inline-flex h-9 items-center gap-2 rounded border border-outline-variant px-4 text-body-md font-medium text-primary transition-colors hover:bg-surface-container"
						type="button"
					>
						Edit
					</button>
					<button
						className="inline-flex h-9 items-center gap-2 rounded bg-secondary px-6 text-body-md font-medium text-on-secondary transition-opacity hover:opacity-90"
						type="button"
					>
						<svg aria-hidden="true" className="size-[18px]" fill="currentColor" viewBox="0 0 24 24">
							<path d="M8 5.5v13l11-6.5L8 5.5Z" />
						</svg>
						Run
					</button>
				</div>
			</div>

			<div className="flex items-center gap-8 border-b border-outline-variant" role="tablist">
				{TABS.map((tab) => {
					const isActive = tab.id === activeTab;
					return (
						<button
							aria-selected={isActive}
							className={
								isActive
									? "border-b-2 border-primary pb-3 text-body-md font-semibold text-primary"
									: "pb-3 text-body-md text-on-surface-variant transition-colors hover:text-primary"
							}
							key={tab.id}
							onClick={() => setActiveTab(tab.id)}
							role="tab"
							type="button"
						>
							{tab.label}
						</button>
					);
				})}
			</div>

			<div role="tabpanel">
				<TabContent caseStatus={testCase.status} tab={activeTab} />
			</div>
		</div>
	);
}
